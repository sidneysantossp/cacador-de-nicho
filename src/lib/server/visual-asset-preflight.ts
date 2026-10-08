import 'server-only';

import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SceneAssetVisualQa } from '@/lib/types';
import { VISUAL_QA_POLICY_VERSION } from '@/lib/pre-render-visual-policy';
import {
  applyDocumentarySourcePolicy, routePrefersMotion, sourceRouteForScene
} from '@/lib/source-router-policy';
import { checked, db } from './db';
import { HttpError } from './auth';
import { downloadMedia, downloadMediaToFile } from './media-storage';
import { probeVideoInput } from './media-probe';
import { loadScenePlan } from './scene-timecode';
import { loadVisualPromptSet } from './visual-prompt-engine';
import { loadProductionDna } from './production-dna';
import {
  verifyVisualFramesWithOpenAI, type ImageVerification, type VisualVerificationFrame
} from './visual-image-verification';

const execFile=promisify(execFileCallback);
const FFMPEG=process.env.FFMPEG_PATH||'ffmpeg';

type AssetRow={
  id:string;
  scene_plan_id:string;
  visual_prompt_set_id:string;
  scene_id:string;
  asset_kind:'image'|'video'|'graphic';
  status:string;
  selected:boolean;
  storage_path:string;
  mime_type:string;
  payload:unknown;
};

function object(value:unknown){
  return value&&typeof value==='object'?value as Record<string,unknown>:{};
}

function visualQa(value:unknown):SceneAssetVisualQa|undefined{
  const item=object(value);
  const qa=object(item.visualQa);
  if(!qa.policyVersion||!qa.status)return undefined;
  return qa as unknown as SceneAssetVisualQa;
}

async function assetRow(assetId:string){
  const row=checked(await db().from('radar_scene_assets')
    .select('id,scene_plan_id,visual_prompt_set_id,scene_id,asset_kind,status,selected,storage_path,mime_type,payload')
    .eq('id',assetId)
    .maybeSingle());
  return row as AssetRow|null;
}

function reusedImageVerification(payload:Record<string,unknown>):ImageVerification|null{
  const source=object(payload.sourceRouterVerification);
  if(
    typeof source.relevance!=='number'||
    typeof source.qualityScore!=='number'||
    typeof source.editorialUsefulness!=='number'||
    typeof source.placeholderLike!=='boolean'||
    typeof source.templateLike!=='boolean'||
    typeof source.staticGraphic!=='boolean'||
    typeof source.visualClass!=='string'
  )return null;
  return {
    model:String(source.model??'source-router-visual-review'),
    relevance:Number(source.relevance),
    qualityScore:Number(source.qualityScore),
    editorialUsefulness:Number(source.editorialUsefulness),
    summary:String(source.summary??''),
    matchedEvidence:Array.isArray(source.matchedEvidence)?source.matchedEvidence.map(String):[],
    mismatchReason:String(source.mismatchReason??''),
    focusX:typeof source.focusX==='number'?source.focusX:.5,
    focusY:typeof source.focusY==='number'?source.focusY:.5,
    focusLabel:String(source.focusLabel??''),
    placeholderLike:Boolean(source.placeholderLike),
    templateLike:Boolean(source.templateLike),
    staticGraphic:Boolean(source.staticGraphic),
    visualClass:source.visualClass as ImageVerification['visualClass'],
    issues:Array.isArray(source.issues)?source.issues.map(String):[]
  };
}

function sumFreezeSeconds(stderr:string){
  let total=0;
  const regex=/freeze_duration:\s*([0-9.]+)/g;
  let match:RegExpExecArray|null;
  while((match=regex.exec(stderr)))total+=Number(match[1]??0)||0;
  return total;
}

function sumBlackSeconds(stderr:string){
  let total=0;
  const regex=/black_duration:([0-9.]+)/g;
  let match:RegExpExecArray|null;
  while((match=regex.exec(stderr)))total+=Number(match[1]??0)||0;
  return total;
}

function sourceTrim(payload:Record<string,unknown>){
  for(const key of ['verifiedStock','owned']){
    const item=object(payload[key]);
    const start=Number(item.sourceStartSeconds);
    const end=Number(item.sourceEndSeconds);
    if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start){
      return {start,end};
    }
  }
  return null;
}

async function videoSamples(
  storagePath:string,
  requestedTrim?:{start:number;end:number}|null
){
  const root=await mkdtemp(path.join(tmpdir(),'cacadores-visual-qa-'));
  const input=path.join(root,'input.mp4');
  try{
    await downloadMediaToFile(storagePath,input);
    const technical=await probeVideoInput(input);
    const sourceDuration=Math.max(.1,technical.durationSeconds??0);
    const trimStart=requestedTrim
      ?Math.max(0,Math.min(sourceDuration-.01,requestedTrim.start))
      :0;
    const trimEnd=requestedTrim
      ?Math.max(trimStart+.01,Math.min(sourceDuration,requestedTrim.end))
      :sourceDuration;
    const duration=Math.max(.01,trimEnd-trimStart);
    const requested=duration>=1
      ?[
          trimStart+duration*.10,
          trimStart+duration*.50,
          trimStart+duration*.90
        ]
      :[trimStart];
    const unique=[...new Set(requested.map(value=>
      Math.max(trimStart,Math.min(trimEnd-.005,value)).toFixed(3)
    ))];
    const frames:VisualVerificationFrame[]=[];
    for(let index=0;index<unique.length;index++){
      const target=path.join(root,'frame-'+String(index+1).padStart(2,'0')+'.jpg');
      await execFile(FFMPEG,[
        '-hide_banner','-loglevel','error',
        '-ss',unique[index],
        '-i',input,
        '-frames:v','1',
        '-vf',"scale='min(960,iw)':-2",
        '-q:v','4',
        '-y',target
      ],{timeout:60000,maxBuffer:2*1024*1024});
      frames.push({
        bytes:await readFile(target),
        mimeType:'image/jpeg',
        label:index===0?'START':index===unique.length-1?'END':'MIDDLE'
      });
    }

    let freezeSeconds:number|null=null;
    let freezeRatio:number|null=null;
    let blackSeconds:number|null=null;
    let blackRatio:number|null=null;
    let meaningfulMotion:boolean|null=null;
    try{
      const result=await execFile(FFMPEG,[
        '-hide_banner','-nostats',
        '-ss',trimStart.toFixed(3),
        '-i',input,
        '-t',duration.toFixed(3),
        '-map','0:v:0','-an',
        '-vf','blackdetect=d=0.2:pix_th=0.10,freezedetect=n=-45dB:d=0.5',
        '-f','null','-'
      ],{timeout:120000,maxBuffer:4*1024*1024});
      const stderr=String(result.stderr??'');
      freezeSeconds=Math.max(0,sumFreezeSeconds(stderr));
      freezeRatio=Math.max(0,Math.min(1,freezeSeconds/duration));
      blackSeconds=Math.max(0,sumBlackSeconds(stderr));
      blackRatio=Math.max(0,Math.min(1,blackSeconds/duration));
      meaningfulMotion=freezeRatio<.60&&blackRatio<.60;
    }catch{
      freezeSeconds=null;
      freezeRatio=null;
      blackSeconds=null;
      blackRatio=null;
      meaningfulMotion=null;
    }

    return {
      frames,
      motion:{
        sampledFrames:frames.length,
        freezeSeconds,
        freezeRatio,
        blackSeconds,
        blackRatio,
        meaningfulMotion
      }
    };
  }finally{
    await rm(root,{recursive:true,force:true}).catch(()=>{});
  }
}

function reviewIssues(input:{
  verification:ImageVerification;
  assetKind:AssetRow['asset_kind'];
  motionExpected:boolean;
  motion?:SceneAssetVisualQa['motion'];
}){
  const issues:string[]=[];
  const v=input.verification;
  if(v.relevance<.50)issues.push('weak-semantic-match');
  if(v.qualityScore<.50)issues.push('low-production-quality');
  if(v.editorialUsefulness<.50)issues.push('low-editorial-usefulness');
  if(v.placeholderLike)issues.push('placeholder-like');
  if(v.templateLike&&v.editorialUsefulness<.72)issues.push('generic-template');
  if(v.visualClass==='text-card'&&v.editorialUsefulness<.75)issues.push('text-card-filler');
  if(input.assetKind==='video'&&v.staticGraphic&&v.templateLike){
    issues.push('template-animation-not-motion');
  }
  if(
    input.assetKind==='video'&&
    input.motionExpected&&
    input.motion?.meaningfulMotion!==true
  ){
    issues.push('insufficient-meaningful-motion');
  }
  if(input.assetKind==='video'&&input.motionExpected&&v.staticGraphic){
    issues.push('static-graphic-disguised-as-video');
  }
  return [...new Set(issues)];
}

async function persistReview(
  row:AssetRow,
  payload:Record<string,unknown>,
  review:SceneAssetVisualQa
){
  const update:Record<string,unknown>={
    payload:{...payload,visualQa:review},
    updated_at:new Date().toISOString()
  };
  if(review.status==='reject'){
    update.status='rejected';
    update.selected=false;
  }
  checked(await db().from('radar_scene_assets').update(update).eq('id',row.id));
}

function blockedReview(query:string,error:unknown):SceneAssetVisualQa{
  const message=error instanceof Error?error.message:'Visual reviewer unavailable.';
  return {
    policyVersion:VISUAL_QA_POLICY_VERSION,
    status:'blocked',
    reviewedAt:new Date().toISOString(),
    model:(process.env.VISUAL_IMAGE_VERIFICATION_MODEL??'gpt-5.6-luna').trim()||'gpt-5.6-luna',
    query,
    relevance:0,
    qualityScore:0,
    editorialUsefulness:0,
    placeholderLike:false,
    templateLike:false,
    staticGraphic:false,
    visualClass:'other',
    issues:['visual-reviewer-unavailable'],
    summary:message,
    motion:undefined
  };
}

export async function ensureSceneAssetVisualQa(assetId:string):Promise<SceneAssetVisualQa>{
  const row=await assetRow(assetId);
  if(!row)throw new HttpError('Asset visual não encontrado para Pre-Render Visual QA.',404);
  const payload=object(row.payload);
  const cached=visualQa(payload);
  if(cached?.policyVersion===VISUAL_QA_POLICY_VERSION&&cached.status!=='blocked'){
    return cached;
  }
  if(row.status!=='ready'){
    if(row.status==='rejected'&&cached)return cached;
    throw new HttpError('O asset precisa estar pronto antes do Pre-Render Visual QA.',409);
  }
  if(!row.storage_path)throw new HttpError('O asset visual não possui arquivo para revisão.',409);

  const plan=await loadScenePlan(row.scene_plan_id);
  if(!plan)throw new HttpError('Contexto visual do asset não está disponível para QA.',409);
  const [promptSet,dna]=await Promise.all([
    loadVisualPromptSet(row.visual_prompt_set_id),
    loadProductionDna(plan.channelId)
  ]);
  if(!promptSet)throw new HttpError('Contexto visual do asset não está disponível para QA.',409);
  const scene=plan.scenes.find(item=>item.id===row.scene_id);
  const visual=promptSet.scenePrompts.find(item=>item.sceneId===row.scene_id);
  if(!scene||!visual)throw new HttpError('Cena/prompt do asset não estão disponíveis para QA.',409);

  const route=applyDocumentarySourcePolicy(
    sourceRouteForScene(scene,visual.direction),
    dna?.research?.documentaryMode===true
  );
  const motionExpected=routePrefersMotion(route);
  const query=[
    route.query,
    scene.narration,
    scene.visualIntent,
    visual.direction
  ].map(value=>value?.trim()).filter(Boolean).join(' | ').slice(0,1800);

  let motion:SceneAssetVisualQa['motion']=undefined;
  let verification:ImageVerification;
  try{
    if(row.asset_kind==='video'){
      const sampled=await videoSamples(row.storage_path,sourceTrim(payload));
      motion=sampled.motion;
      verification=await verifyVisualFramesWithOpenAI({
        frames:sampled.frames,
        query,
        motionExpected
      });
    }else{
      const reused=reusedImageVerification(payload);
      verification=reused??await verifyVisualFramesWithOpenAI({
        frames:[{
          bytes:await downloadMedia(row.storage_path),
          mimeType:row.mime_type||'image/jpeg',
          label:'STILL'
        }],
        query,
        motionExpected:false
      });
    }
  }catch(error){
    const blocked=blockedReview(query,error);
    await persistReview(row,payload,blocked);
    throw error;
  }

  const issues=reviewIssues({
    verification,
    assetKind:row.asset_kind,
    motionExpected,
    motion
  });
  const review:SceneAssetVisualQa={
    policyVersion:VISUAL_QA_POLICY_VERSION,
    status:issues.length?'reject':'pass',
    reviewedAt:new Date().toISOString(),
    model:verification.model,
    query,
    relevance:verification.relevance,
    qualityScore:verification.qualityScore,
    editorialUsefulness:verification.editorialUsefulness,
    placeholderLike:verification.placeholderLike,
    templateLike:verification.templateLike,
    staticGraphic:verification.staticGraphic,
    visualClass:verification.visualClass,
    issues:[...new Set([...issues,...verification.issues])],
    summary:verification.summary,
    motion
  };
  await persistReview(row,payload,review);
  return review;
}

export async function assertSceneAssetVisualQa(assetId:string){
  const review=await ensureSceneAssetVisualQa(assetId);
  if(review.status!=='pass'){
    throw new HttpError(
      'Pre-Render Visual QA reprovou o asset: '+
      (review.issues.length?review.issues.join(' · '):review.summary||'revisão visual pendente')+'.',
      409
    );
  }
  return review;
}

export function isVisualQaRejection(error:unknown){
  return error instanceof HttpError&&error.message.startsWith('Pre-Render Visual QA reprovou o asset:');
}
