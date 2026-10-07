import type {
  ProductionDNA, SceneAssetVisualQa, ScenePlanPayload
} from './types';

export const VISUAL_QA_POLICY_VERSION='visual-qa-v1' as const;

const MOTION_PREFERENCE_RE=/(?:motion-first|video-first|prefer.{0,48}(?:motion|video)|prioriti[sz]e.{0,48}(?:motion|video)|avoid.{0,48}(?:static|slideshow)|no generic ai slideshow|over static slides)/i;
const GENERIC_STATIC_CLASS=new Set(['diagram','interface-card','text-card','evidence-board']);

function compact(value:string){
  return value.toLowerCase().replace(/\s+/g,' ').trim();
}

function ratio(part:number,total:number){
  return total>0?part/total:0;
}

function dominantShare(values:string[]){
  const normalized=values.map(compact).filter(Boolean);
  if(!normalized.length)return {value:'',share:0};
  const counts=new Map<string,number>();
  for(const value of normalized)counts.set(value,(counts.get(value)??0)+1);
  let value='',count=0;
  for(const [candidate,total] of counts){
    if(total>count){value=candidate;count=total;}
  }
  return {value,share:count/normalized.length};
}

export function productionPrefersMotion(dna:ProductionDNA|null|undefined){
  if(!dna)return false;
  const text=[
    dna.visual.styleDescription,
    dna.visual.negativePrompt,
    ...dna.visual.motionRules,
    ...dna.visual.cameraRules,
    ...dna.editing.pacingRules
  ].join(' ');
  return MOTION_PREFERENCE_RE.test(text);
}

export function scenePlanVisualStrategyIssues(
  payload:ScenePlanPayload,
  dna:ProductionDNA|null|undefined
){
  const issues:string[]=[];
  const scenes=payload.scenes;
  if(scenes.length<12)return issues;

  const beats=scenes.flatMap(scene=>scene.visualBeats??[]);
  const motionFirst=productionPrefersMotion(dna);
  const generated=beats.filter(beat=>beat.sourcePreference==='generated').length;
  const motionPlanned=beats.filter(beat=>
    beat.sourcePreference==='stock-video'||beat.sourcePreference==='mixed'
  ).length;
  const imageModes=scenes.filter(scene=>scene.assetMode==='image').length;
  const shot=dominantShare(scenes.map(scene=>scene.shotType));
  const direction=dominantShare(scenes.map(scene=>
    [scene.visualIntent,scene.promptDirection].map(compact).filter(Boolean).join(' | ')
  ));

  if((motionFirst||dna?.research?.documentaryMode===true)&&ratio(generated,beats.length)>.70){
    issues.push('visual-strategy-generated-concentration');
  }
  if(motionFirst&&ratio(motionPlanned,beats.length)<.45){
    issues.push('visual-strategy-motion-underplanned');
  }
  if(motionFirst&&ratio(imageModes,scenes.length)>.60){
    issues.push('visual-strategy-image-heavy');
  }
  const documentary=dna?.research?.documentaryMode===true;
  const genericShot=/(diagram|system|visualization|illustration|template|slide|card)/i.test(shot.value);
  if(shot.value&&shot.share>.55&&(motionFirst||documentary||genericShot)){
    issues.push('visual-strategy-shot-type-concentration');
  }
  const directionLimit=motionFirst||documentary?.55:.80;
  if(direction.value&&direction.share>directionLimit){
    issues.push('visual-strategy-direction-repetition');
  }

  return [...new Set(issues)];
}

export type PreRenderVisualQaAsset = {
  assetId:string;
  sceneId:string;
  assetKind:'image'|'video'|'graphic';
  visualQa?:SceneAssetVisualQa;
};

export function preRenderVisualQaIssues(input:{
  assets:PreRenderVisualQaAsset[];
  dna:ProductionDNA|null|undefined;
}){
  const issues:string[]=[];
  const assets=input.assets;
  if(!assets.length)return ['visual-qa-no-assets'];

  const missing=assets.filter(asset=>!asset.visualQa);
  const rejected=assets.filter(asset=>asset.visualQa&&asset.visualQa.status!=='pass');
  const placeholder=assets.filter(asset=>asset.visualQa?.placeholderLike);
  const template=assets.filter(asset=>asset.visualQa?.templateLike);
  const staticGraphics=assets.filter(asset=>asset.visualQa?.staticGraphic);
  const videos=assets.filter(asset=>asset.assetKind==='video');
  const motionlessVideos=videos.filter(asset=>
    asset.visualQa?.motion?.meaningfulMotion!==true||
    asset.visualQa?.staticGraphic===true
  );

  if(missing.length)issues.push('visual-qa-incomplete');
  if(rejected.length)issues.push('visual-qa-rejected');
  if(placeholder.length)issues.push('visual-placeholder-detected');

  const motionFirst=productionPrefersMotion(input.dna);
  if(motionFirst&&motionlessVideos.length){
    issues.push('visual-video-without-meaningful-motion');
  }
  if(
    motionFirst&&
    assets.length>=12&&
    ratio(staticGraphics.length,assets.length)>.35
  ){
    issues.push('visual-static-graphic-concentration');
  }
  if(
    assets.length>=12&&
    ratio(template.length,assets.length)>(motionFirst?.20:.40)
  ){
    issues.push('visual-template-concentration');
  }

  const classes=assets
    .map(asset=>asset.visualQa?.visualClass??'')
    .filter(value=>GENERIC_STATIC_CLASS.has(value));
  const dominantStatic=dominantShare(classes);
  if(
    motionFirst&&
    assets.length>=12&&
    dominantStatic.value&&
    ratio(classes.length,assets.length)>.35&&
    dominantStatic.share>.55
  ){
    issues.push('visual-static-class-concentration');
  }

  return [...new Set(issues)];
}
