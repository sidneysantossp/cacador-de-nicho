import 'server-only';

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  ContentProjectPayload, ManagedChannel, PublicationPackage, PublicationPackagePayload,
  PublicationPackageStatus, PublicationPackageVersion
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadProductionQualityReport, listProductionQualityReports } from './production-quality';
import { loadRenderJob, listRenderJobs } from './render-engine';
import {
  initialPublicationPackage, normalizePublicationTags, publicationPackageIssues
} from '@/lib/publication-package-policy';

const BUCKET='cacadores-media';
const FFPROBE=process.env.FFPROBE_PATH||'ffprobe';
const MAX_THUMBNAIL_BYTES=2*1024*1024;

type Row={
  id:string;
  channel_id:string;
  episode_id:string;
  quality_report_id:string;
  render_job_id:string;
  version:number;
  status:PublicationPackageStatus;
  payload:unknown;
  created_at:string;
  updated_at:string;
};

const selection='id,channel_id,episode_id,quality_report_id,render_job_id,version,status,payload,created_at,updated_at';

async function signed(storagePath:string|null|undefined){
  if(!storagePath)return null;
  const result=await db().storage.from(BUCKET).createSignedUrl(storagePath,3600);
  return result.error?null:result.data.signedUrl;
}

async function normalizeRow(row:Row):Promise<PublicationPackage>{
  const payload=row.payload as PublicationPackagePayload;
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    qualityReportId:row.quality_report_id,
    renderJobId:row.render_job_id,
    version:Number(row.version),
    status:row.status,
    thumbnailSignedUrl:await signed(payload.thumbnail.storagePath),
    renderOutputSignedUrl:await signed(payload.renderOutputPath),
    createdAt:payload.createdAt??String(row.created_at),
    updatedAt:payload.updatedAt??String(row.updated_at)
  };
}

export async function listPublicationPackages(channelId:string):Promise<PublicationPackage[]>{
  const rows=checked(await db().from('radar_publication_packages')
    .select(selection)
    .eq('channel_id',channelId)
    .order('updated_at',{ascending:false})
    .limit(200));
  return Promise.all((rows??[]).map(row=>normalizeRow(row as Row)));
}

export async function loadPublicationPackage(packageId:string):Promise<PublicationPackage|null>{
  const row=checked(await db().from('radar_publication_packages')
    .select(selection)
    .eq('id',packageId)
    .maybeSingle());
  return row?normalizeRow(row as Row):null;
}

export async function loadPublicationPackageHistory(packageId:string,limit=20):Promise<PublicationPackageVersion[]>{
  const rows=checked(await db().from('radar_publication_package_versions')
    .select('version,status,payload,created_at')
    .eq('publication_package_id',packageId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,50))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as PublicationPackageStatus,
    payload:row.payload as PublicationPackagePayload,
    createdAt:String(row.created_at)
  }));
}

async function savePackage(
  payload:PublicationPackagePayload,
  status:PublicationPackageStatus,
  expectedVersion:number|null
):Promise<PublicationPackage>{
  const result=await db().rpc('save_publication_package',{
    p_package_id:payload.id,
    p_channel_id:payload.channelId,
    p_episode_id:payload.episodeId,
    p_quality_report_id:payload.qualityReportId,
    p_render_job_id:payload.renderJobId,
    p_status:status,
    p_payload:payload,
    p_expected_version:expectedVersion
  });
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('publication package version conflict')){
      throw new HttpError('Publication Package desatualizado. Recarregue antes de salvar.',409);
    }
    if(message.includes('quality report already has publication package')){
      throw new HttpError('Este Production QA já possui um Publication Package.',409);
    }
    if(message.includes('publication package source not eligible')){
      throw new HttpError('A origem deste package não está elegível para publicação.',409);
    }
    throw new HttpError('Falha ao salvar Publication Package no Supabase.',502);
  }
  const version=Number(result.data);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar Publication Package.',502);
  const saved=await loadPublicationPackage(payload.id);
  if(!saved)throw new HttpError('Package salvo, mas não pôde ser recarregado.',502);
  return saved;
}

function cleanPayload(payload:PublicationPackagePayload):PublicationPackagePayload{
  return {
    ...payload,
    metadata:{
      ...payload.metadata,
      title:payload.metadata.title.trim(),
      description:payload.metadata.description.trim(),
      tags:normalizePublicationTags(payload.metadata.tags),
      language:payload.metadata.language.trim(),
      categoryId:payload.metadata.categoryId.trim()
    },
    thumbnail:{
      ...payload.thumbnail,
      concept:payload.thumbnail.concept.trim(),
      overlayText:payload.thumbnail.overlayText.trim(),
      altText:payload.thumbnail.altText.trim()
    },
    review:{...payload.review,notes:payload.review.notes.trim().slice(0,5000)},
    updatedAt:new Date().toISOString()
  };
}

async function managedChannel(channelId:string):Promise<ManagedChannel>{
  const row=checked(await db().from('radar_managed_channels')
    .select('payload')
    .eq('id',channelId)
    .maybeSingle());
  if(!row)throw new HttpError('Canal não encontrado.',404);
  return row.payload as ManagedChannel;
}

async function episodeSeed(episodeId:string){
  const [episodeRow,projectRows]=await Promise.all([
    db().from('radar_episodes').select('payload').eq('id',episodeId).maybeSingle(),
    db().from('radar_content_projects')
      .select('payload,status,updated_at')
      .eq('episode_id',episodeId)
      .eq('status','approved')
      .order('updated_at',{ascending:false})
      .limit(1)
  ]);
  const episode=checked(episodeRow)?.payload as Record<string,unknown>|undefined;
  const projects=checked(projectRows)??[];
  const project=(projects[0]?.payload??null) as ContentProjectPayload|null;
  const brief=project?.brief;
  const episodeTitle=String(episode?.title??'').trim();
  const title=(brief?.workingTitle??episodeTitle).trim();
  const description=[
    brief?.promise?.trim(),
    brief?.thesis?.trim()
  ].filter(Boolean).join('\n\n');
  const tags=[
    ...((episode?.introducesConcepts as string[]|undefined)??[]),
    ...((episode?.reinforcesConcepts as string[]|undefined)??[])
  ];
  return {
    title,
    description,
    tags,
    thumbnailConcept:brief?.thumbnailConcept??''
  };
}

export async function createPublicationPackage(qualityReportId:string){
  const quality=await loadProductionQualityReport(qualityReportId);
  if(!quality)throw new HttpError('Production QA não encontrado.',404);
  if(quality.status!=='approved')throw new HttpError('Aprove o Production QA antes de criar o package.',409);

  const existing=checked(await db().from('radar_publication_packages')
    .select('id')
    .eq('quality_report_id',quality.id)
    .maybeSingle());
  if(existing){
    const pkg=await loadPublicationPackage(String(existing.id));
    if(pkg)return pkg;
  }

  const render=await loadRenderJob(quality.renderJobId);
  if(!render||render.status!=='completed'||!render.outputPath){
    throw new HttpError('O render aprovado pelo QA não está disponível.',409);
  }

  const [channel,seed]=await Promise.all([
    managedChannel(quality.channelId),
    episodeSeed(quality.episodeId)
  ]);
  const id=crypto.randomUUID();
  const payload=initialPublicationPackage({
    id,channel,qualityReport:quality,renderJob:render,
    title:seed.title,description:seed.description,tags:seed.tags,
    language:'en',thumbnailConcept:seed.thumbnailConcept
  });
  return savePackage(payload,'draft',0);
}

async function packageContext(payload:PublicationPackagePayload){
  const [quality,render]=await Promise.all([
    loadProductionQualityReport(payload.qualityReportId),
    loadRenderJob(payload.renderJobId)
  ]);
  return {qualityReport:quality,renderJob:render};
}

export async function savePublicationPackage(input:{
  packageId:string;
  expectedVersion:number;
  payload:PublicationPackagePayload;
  approve?:boolean;
}){
  const current=await loadPublicationPackage(input.packageId);
  if(!current)throw new HttpError('Publication Package não encontrado.',404);
  if(current.version!==input.expectedVersion)throw new HttpError('Publication Package desatualizado. Recarregue antes de salvar.',409);
  if(current.status==='approved')throw new HttpError('Package aprovado é imutável. Crie uma nova revisão de release para alterá-lo.',409);
  if(input.payload.id!==current.id||
     input.payload.channelId!==current.channelId||
     input.payload.episodeId!==current.episodeId||
     input.payload.qualityReportId!==current.qualityReportId||
     input.payload.renderJobId!==current.renderJobId){
    throw new HttpError('Os vínculos estruturais do Publication Package não podem ser alterados.',400);
  }

  const payload=cleanPayload({
    ...input.payload,
    qualityReportVersion:current.qualityReportVersion,
    renderOutputPath:current.renderOutputPath,
    createdAt:current.createdAt
  });
  const context=await packageContext(payload);

  if(input.approve){
    const issues=publicationPackageIssues(payload,context);
    const blockers=issues.filter(issue=>issue.level==='blocker');
    if(blockers.length){
      throw new HttpError('Publication Package ainda não pode ser aprovado: '+blockers.map(issue=>issue.message).join(' · '),409);
    }
    const now=new Date().toISOString();
    payload.review={...payload.review,approvedAt:now,approvedBy:'operator'};
    payload.updatedAt=now;
    return savePackage(payload,'approved',current.version);
  }

  return savePackage(payload,'draft',current.version);
}

function probeImage(filePath:string){
  return new Promise<{width:number;height:number}>((resolve,reject)=>{
    const child=spawn(FFPROBE,[
      '-v','error','-select_streams','v:0',
      '-show_entries','stream=width,height','-of','json',filePath
    ],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk.toString());
    child.stderr.on('data',chunk=>stderr=(stderr+chunk.toString()).slice(-2000));
    child.on('error',reject);
    child.on('close',code=>{
      try{
        const parsed=JSON.parse(stdout) as {streams?:Array<{width?:number;height?:number}>};
        const stream=parsed.streams?.[0];
        const width=Number(stream?.width),height=Number(stream?.height);
        if(code===0&&Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0){
          resolve({width,height});
        }else reject(new Error(stderr||'ffprobe image failed'));
      }catch(error){reject(error);}
    });
  });
}

export async function uploadPublicationThumbnail(input:{
  packageId:string;
  expectedVersion:number;
  file:File;
}){
  const current=await loadPublicationPackage(input.packageId);
  if(!current)throw new HttpError('Publication Package não encontrado.',404);
  if(current.version!==input.expectedVersion)throw new HttpError('Publication Package desatualizado. Recarregue antes do upload.',409);
  if(current.status==='approved')throw new HttpError('Package aprovado é imutável.',409);
  if(input.file.size<=0)throw new HttpError('A thumbnail está vazia.',400);
  if(input.file.size>MAX_THUMBNAIL_BYTES)throw new HttpError('A thumbnail excede o limite de 2 MB.',413);

  const mime=input.file.type==='image/jpg'?'image/jpeg':input.file.type;
  if(mime!=='image/jpeg'&&mime!=='image/png'){
    throw new HttpError('Use thumbnail JPEG ou PNG.',415);
  }

  const bytes=Buffer.from(await input.file.arrayBuffer());
  const dir=await mkdtemp(path.join(os.tmpdir(),'cacadores-thumb-'));
  const ext=mime==='image/png'?'png':'jpg';
  const local=path.join(dir,'thumbnail.'+ext);
  let dimensions:{width:number;height:number};
  try{
    await writeFile(local,bytes);
    dimensions=await probeImage(local);
  }catch{
    throw new HttpError('Não foi possível ler as dimensões da thumbnail.',415);
  }finally{
    await rm(dir,{recursive:true,force:true}).catch(()=>{});
  }

  const storagePath=[
    'channels',current.channelId,'episodes',current.episodeId,
    'publication',current.id,'thumbnails',crypto.randomUUID()+'.'+ext
  ].join('/');

  const upload=await db().storage.from(BUCKET).upload(storagePath,bytes,{
    contentType:mime,upsert:false,cacheControl:'3600'
  });
  if(upload.error)throw new HttpError('Falha ao armazenar thumbnail.',502);

  const payload:PublicationPackagePayload=cleanPayload({
    ...current,
    thumbnail:{
      ...current.thumbnail,
      source:'uploaded',
      storagePath,
      mimeType:mime,
      originalName:input.file.name,
      bytes:bytes.length,
      width:dimensions.width,
      height:dimensions.height
    },
    review:{...current.review,approvedAt:undefined,approvedBy:undefined}
  });
  const {version:_version,status:_status,thumbnailSignedUrl:_thumbUrl,renderOutputSignedUrl:_renderUrl,...clean}=payload as PublicationPackage;

  try{
    return await savePackage(clean,'draft',current.version);
  }catch(error){
    await db().storage.from(BUCKET).remove([storagePath]).catch(()=>{});
    throw error;
  }
}

export async function publicationPackageChannelState(channelId:string){
  const [packages,qualityReports,renders]=await Promise.all([
    listPublicationPackages(channelId),
    listProductionQualityReports(channelId),
    listRenderJobs(channelId)
  ]);
  const packageQuality=new Set(packages.map(pkg=>pkg.qualityReportId));
  return {
    packages,
    eligibleQualityReports:qualityReports.filter(report=>report.status==='approved'&&!packageQuality.has(report.id)),
    renders:renders.filter(render=>render.status==='completed')
  };
}
