import type {
  ManagedChannel, PublicationPackageIssue, PublicationPackagePayload,
  ProductionQualityReport, RenderJob
} from '@/lib/types';

export const YOUTUBE_CATEGORIES=[
  {id:'1',label:'Film & Animation'},
  {id:'2',label:'Autos & Vehicles'},
  {id:'10',label:'Music'},
  {id:'15',label:'Pets & Animals'},
  {id:'17',label:'Sports'},
  {id:'19',label:'Travel & Events'},
  {id:'20',label:'Gaming'},
  {id:'22',label:'People & Blogs'},
  {id:'23',label:'Comedy'},
  {id:'24',label:'Entertainment'},
  {id:'25',label:'News & Politics'},
  {id:'26',label:'Howto & Style'},
  {id:'27',label:'Education'},
  {id:'28',label:'Science & Technology'},
  {id:'29',label:'Nonprofits & Activism'}
] as const;

function includesAny(value:string,terms:string[]){
  const normalized=value.toLowerCase();
  return terms.some(term=>normalized.includes(term));
}

export function inferYoutubeCategory(channel:Pick<ManagedChannel,'niche'|'format'>){
  const value=(channel.niche+' '+channel.format).toLowerCase();
  if(includesAny(value,['music','song','guitar','piano','viola','musical']))return '10';
  if(includesAny(value,['pet','animal','dog','cat','wildlife','bird','fish']))return '15';
  if(includesAny(value,['sport','football','soccer','basketball','tennis','fitness']))return '17';
  if(includesAny(value,['travel','tourism','trip','destination']))return '19';
  if(includesAny(value,['gaming','gameplay','video game']))return '20';
  if(includesAny(value,['comedy','humor','funny']))return '23';
  if(includesAny(value,['entertainment','celebrity','showbiz']))return '24';
  if(includesAny(value,['news','politics','current affairs']))return '25';
  if(includesAny(value,['how to','howto','craft','diy','beauty','style','cooking','recipe']))return '26';
  if(includesAny(value,['technology','tech','ai','artificial intelligence','science','engineering']))return '28';
  if(includesAny(value,['film','animation','animated','cinema']))return '1';
  return '27';
}

export function normalizePublicationTags(tags:string[]){
  const seen=new Set<string>();
  const result:string[]=[];
  for(const raw of tags){
    const value=raw.trim().replace(/^#+/,'').replace(/\s+/g,' ');
    if(!value)continue;
    const key=value.toLowerCase();
    if(seen.has(key))continue;
    seen.add(key);
    result.push(value.slice(0,100));
    if(result.length>=50)break;
  }
  return result;
}

export function publicationTagCharacters(tags:string[]){
  return normalizePublicationTags(tags).join(',').length;
}

export function initialPublicationPackage(input:{
  id:string;
  channel:ManagedChannel;
  qualityReport:ProductionQualityReport;
  renderJob:RenderJob;
  title?:string;
  description?:string;
  tags?:string[];
  language?:string;
  thumbnailConcept?:string;
}):PublicationPackagePayload{
  const now=new Date().toISOString();
  return {
    kind:'publication-package',
    id:input.id,
    channelId:input.channel.id,
    episodeId:input.qualityReport.episodeId,
    qualityReportId:input.qualityReport.id,
    qualityReportVersion:input.qualityReport.version,
    renderJobId:input.renderJob.id,
    renderOutputPath:input.renderJob.outputPath??'',
    metadata:{
      title:(input.title??'').trim().slice(0,100),
      description:(input.description??'').trim().slice(0,5000),
      tags:normalizePublicationTags(input.tags??[]),
      language:(input.language??'en').trim().slice(0,30)||'en',
      categoryId:inferYoutubeCategory(input.channel),
      visibility:'private',
      audience:'unset',
      syntheticMediaDisclosure:'review',
      license:'youtube'
    },
    thumbnail:{
      source:'none',
      storagePath:null,
      mimeType:null,
      originalName:null,
      bytes:null,
      width:null,
      height:null,
      concept:(input.thumbnailConcept??'').trim().slice(0,4000),
      overlayText:'',
      altText:''
    },
    review:{notes:''},
    createdAt:now,
    updatedAt:now
  };
}

export function publicationPackageIssues(
  pkg:PublicationPackagePayload,
  context:{qualityReport:ProductionQualityReport|null;renderJob:RenderJob|null}
):PublicationPackageIssue[]{
  const issues:PublicationPackageIssue[]=[];
  const add=(code:PublicationPackageIssue['code'],level:PublicationPackageIssue['level'],message:string)=>{
    issues.push({code,level,message});
  };

  const quality=context.qualityReport;
  const render=context.renderJob;

  if(!quality||quality.status!=='approved'){
    add('quality-not-approved','blocker','O Production QA vinculado não está aprovado.');
  }else if(quality.version!==pkg.qualityReportVersion){
    add('quality-version-stale','blocker','O Production QA mudou desde a criação deste package.');
  }

  if(!render||render.status!=='completed'||!render.outputPath){
    add('render-not-completed','blocker','O render vinculado não está concluído com output persistido.');
  }else if(render.outputPath!==pkg.renderOutputPath||render.id!==pkg.renderJobId){
    add('render-output-mismatch','blocker','O output do render não corresponde ao snapshot deste package.');
  }

  const title=pkg.metadata.title.trim();
  if(!title)add('title-missing','blocker','Defina um título antes da aprovação.');
  if(title.length>100)add('title-too-long','blocker','O título ultrapassa 100 caracteres.');

  if(pkg.metadata.description.length>5000){
    add('description-too-long','blocker','A descrição ultrapassa 5.000 caracteres.');
  }

  if(publicationTagCharacters(pkg.metadata.tags)>500){
    add('tags-too-long','blocker','As tags ultrapassam 500 caracteres combinados.');
  }

  if(!pkg.metadata.language.trim())add('language-missing','blocker','Defina o idioma do vídeo.');
  if(!pkg.metadata.categoryId.trim())add('category-missing','blocker','Defina a categoria do YouTube.');
  if(pkg.metadata.audience==='unset'){
    add('audience-unconfirmed','blocker','Confirme se o vídeo é ou não destinado a crianças.');
  }
  if(pkg.metadata.syntheticMediaDisclosure==='review'){
    add('synthetic-disclosure-unconfirmed','blocker','Revise e confirme o disclosure de mídia sintética.');
  }

  const thumb=pkg.thumbnail;
  if(!thumb.storagePath){
    add('thumbnail-missing','blocker','Adicione uma thumbnail antes de aprovar o package.');
  }else{
    if(!['image/jpeg','image/png'].includes(thumb.mimeType??'')){
      add('thumbnail-format','blocker','A thumbnail precisa ser JPEG ou PNG.');
    }
    if((thumb.bytes??0)>2*1024*1024){
      add('thumbnail-too-large','blocker','A thumbnail ultrapassa 2 MB.');
    }
    const width=thumb.width??0,height=thumb.height??0;
    if(width<640||height<360){
      add('thumbnail-too-small','blocker','A thumbnail precisa ter pelo menos 640×360.');
    }
    if(width>0&&height>0){
      const ratio=width/height;
      if(Math.abs(ratio-(16/9))>.02){
        add('thumbnail-aspect-ratio','blocker','A thumbnail precisa estar em proporção 16:9.');
      }else if(width!==1280||height!==720){
        add('thumbnail-nonstandard-size','warning','1280×720 é o tamanho recomendado para a thumbnail.');
      }
    }
  }

  return issues;
}

export function publicationPackageCanApprove(
  pkg:PublicationPackagePayload,
  context:{qualityReport:ProductionQualityReport|null;renderJob:RenderJob|null}
){
  return !publicationPackageIssues(pkg,context).some(issue=>issue.level==='blocker');
}
