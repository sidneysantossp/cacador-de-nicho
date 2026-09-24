import type {
  ExternalImportItem, ExternalImportItemStatus, ExternalImportKind,
  VisualScenePrompt
} from '@/lib/types';

export type ExternalFileDescriptor={
  name:string;
  size:number;
  type:string;
};

export type ExternalMediaMarker=
  | {kind:'production';channelCode:string;episodeNumber:number;sequence:number;takeNumber:number;label:string}
  | {kind:'timecode';startSeconds:number;label:string}
  | {kind:'sequence';sequence:number;label:string};

const imageExtensions=new Set(['png','jpg','jpeg','webp']);
const videoExtensions=new Set(['mp4','webm','mov']);
const audioExtensions=new Set(['mp3','wav','m4a','ogg','webm']);
const transcriptExtensions=new Set(['srt','vtt','txt','json']);

function extension(name:string){
  const clean=name.toLowerCase().split(/[?#]/)[0];
  const dot=clean.lastIndexOf('.');
  return dot>=0?clean.slice(dot+1):'';
}

export function classifyExternalFile(file:Pick<ExternalFileDescriptor,'name'|'type'>):ExternalImportKind{
  const mime=file.type.toLowerCase().split(';')[0].trim();
  const ext=extension(file.name);
  if(mime.startsWith('image/')||imageExtensions.has(ext))return 'image';
  if(mime.startsWith('video/')||videoExtensions.has(ext))return 'video';
  if(mime.startsWith('audio/')||audioExtensions.has(ext))return 'audio';
  if(transcriptExtensions.has(ext)||mime==='application/json'||mime==='text/vtt'||mime==='application/x-subrip')return 'transcript';
  return 'other';
}

export function parseExternalMediaMarker(fileName:string):ExternalMediaMarker|null{
  const stem=fileName.replace(/\.[^.]+$/,'');
  const production=stem.match(/(?:^|[^a-z0-9])([a-z0-9]{2,24})_v0*(\d{1,5})_s0*(\d{1,5})_t0*(\d{1,4})(?=$|[^a-z0-9])/i);
  if(production){
    const episodeNumber=Number(production[2]);
    const sequence=Number(production[3]);
    const takeNumber=Number(production[4]);
    if(episodeNumber>0&&sequence>0&&takeNumber>0){
      const channelCode=production[1].toUpperCase();
      return {
        kind:'production',
        channelCode,
        episodeNumber,
        sequence,
        takeNumber,
        label:channelCode+'_V'+String(episodeNumber).padStart(2,'0')+'_S'+String(sequence).padStart(3,'0')+'_T'+String(takeNumber).padStart(2,'0')
      };
    }
  }

  const scene=stem.match(/(?:^|[^a-z0-9])scene[\s_-]*0*(\d{1,5})(?=$|[^0-9])/i);
  if(scene){
    const sequence=Number(scene[1]);
    if(Number.isInteger(sequence)&&sequence>0)return {kind:'sequence',sequence,label:'scene-'+String(sequence).padStart(3,'0')};
  }

  const matches=[...stem.matchAll(/(?:^|[^0-9])#?(\d{1,3})[-_:](\d{2})(?:[-_:](\d{2}))?(?=$|[^0-9])/g)];
  for(const match of matches){
    const a=Number(match[1]),b=Number(match[2]);
    const hasHours=match[3]!==undefined;
    const c=hasHours?Number(match[3]):null;
    if(!Number.isFinite(a)||!Number.isFinite(b)||b>59)continue;
    if(hasHours&&(c===null||!Number.isFinite(c)||c>59))continue;
    const startSeconds=hasHours?a*3600+b*60+(c??0):a*60+b;
    const label=hasHours
      ?'#'+a+'-'+String(b).padStart(2,'0')+'-'+String(c).padStart(2,'0')
      :'#'+a+'-'+String(b).padStart(2,'0');
    return {kind:'timecode',startSeconds,label};
  }
  return null;
}

export function matchExternalFileToScene(
  fileName:string,
  scenes:Pick<VisualScenePrompt,'sceneId'|'sequence'|'startSeconds'|'timecodeLabel'>[],
  toleranceSeconds=.55
){
  const marker=parseExternalMediaMarker(fileName);
  if(!marker)return {sceneId:null as string|null,marker:null as ExternalMediaMarker|null};

  if(marker.kind==='sequence'||marker.kind==='production'){
    const scene=scenes.find(item=>item.sequence===marker.sequence);
    return {sceneId:scene?.sceneId??null,marker};
  }

  const exact=scenes.find(item=>{
    const parsed=parseExternalMediaMarker(item.timecodeLabel);
    return parsed?.kind==='timecode'&&Math.abs(parsed.startSeconds-marker.startSeconds)<.001;
  });
  if(exact)return {sceneId:exact.sceneId,marker};

  const nearest=[...scenes]
    .map(scene=>({scene,diff:Math.abs(scene.startSeconds-marker.startSeconds)}))
    .sort((a,b)=>a.diff-b.diff)[0];
  return {sceneId:nearest&&nearest.diff<=toleranceSeconds?nearest.scene.sceneId:null,marker};
}

export function previewExternalImportFiles(
  files:ExternalFileDescriptor[],
  scenes:Pick<VisualScenePrompt,'sceneId'|'sequence'|'startSeconds'|'timecodeLabel'>[]=[]
){
  return files.map((file,itemIndex)=>{
    const kind=classifyExternalFile(file);
    const mapping=kind==='image'||kind==='video'
      ?matchExternalFileToScene(file.name,scenes)
      :{sceneId:null,marker:null};
    const status:ExternalImportItemStatus=
      (kind==='image'||kind==='video')&&!mapping.sceneId?'unmatched':
      kind==='other'?'skipped':'pending';
    return {
      itemIndex,
      kind,
      originalName:file.name,
      mimeType:file.type,
      bytes:file.size,
      matchedSceneId:mapping.sceneId??undefined,
      matchedTimeSeconds:mapping.marker?.kind==='timecode'?mapping.marker.startSeconds:undefined,
      status,
      payload:{
        detectedBy:mapping.marker?.kind==='production'?'production-name' as const:
          mapping.marker?.kind==='timecode'?'timecode' as const:
          mapping.marker?.kind==='sequence'?'scene-number' as const:
          kind==='image'||kind==='video'?'none' as const:undefined,
        normalizedMarker:mapping.marker?.label,
        productionChannelCode:mapping.marker?.kind==='production'?mapping.marker.channelCode:undefined,
        productionEpisodeNumber:mapping.marker?.kind==='production'?mapping.marker.episodeNumber:undefined,
        productionSceneNumber:mapping.marker?.kind==='production'?mapping.marker.sequence:undefined,
        productionTakeNumber:mapping.marker?.kind==='production'?mapping.marker.takeNumber:undefined
      }
    };
  });
}

export function externalBatchStatus(items:Pick<ExternalImportItem,'status'>[]){
  if(!items.length)return 'planned' as const;
  const active=items.filter(item=>item.status==='pending'||item.status==='processing').length;
  const ready=items.filter(item=>item.status==='ready'||item.status==='skipped').length;
  const failed=items.filter(item=>item.status==='failed').length;
  const problems=items.filter(item=>item.status==='failed'||item.status==='unmatched').length;
  if(active)return 'processing' as const;
  if(ready===items.length)return 'completed' as const;
  if(failed===items.length)return 'failed' as const;
  if(problems)return 'partial' as const;
  return 'partial' as const;
}
