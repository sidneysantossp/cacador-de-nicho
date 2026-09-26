import type { SceneTimecode, VisualBeat, VisualBeatSourcePreference } from './types';

export type SourceRouteAction =
  | 'owned'
  | 'wikimedia'
  | 'stock-image'
  | 'stock-video'
  | 'generated-image'
  | 'generated-video'
  | 'manual-archive'
  | 'manual-map'
  | 'manual-document';

export type SourceRoutePlan={
  sceneId:string;
  beatId:string|null;
  preference:VisualBeatSourcePreference|'legacy';
  query:string;
  actions:SourceRouteAction[];
  syntheticAllowed:boolean;
  rationale:string;
};

function firstBeat(scene:SceneTimecode):VisualBeat|null{
  return scene.visualBeats?.[0]??null;
}

function firstQuery(scene:SceneTimecode,beat:VisualBeat|null){
  const beatQuery=beat?.queries.find(value=>value.trim())?.trim()??'';
  return (
    beatQuery||
    scene.visualIntent.trim()||
    scene.promptDirection.trim()||
    scene.narration.trim()
  ).slice(0,500);
}

export function sourceRouteForScene(scene:SceneTimecode):SourceRoutePlan{
  const beat=firstBeat(scene);
  const preference=beat?.sourcePreference??'legacy';
  const query=firstQuery(scene,beat);

  if(preference==='archive-image'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','wikimedia','manual-archive'],
      syntheticAllowed:false,
      rationale:'Historical/archive beat: require authentic or reusable documentary imagery; never substitute modern stock or synthetic evidence.'
    };
  }
  if(preference==='document'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','wikimedia','manual-document'],
      syntheticAllowed:false,
      rationale:'Documentary evidence beat: preserve factual provenance and avoid synthetic substitution.'
    };
  }
  if(preference==='map'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','wikimedia','manual-map'],
      syntheticAllowed:false,
      rationale:'Geographic beat: use a real map or sourced geographic asset.'
    };
  }
  if(preference==='stock-video'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','stock-video','stock-image'],
      syntheticAllowed:false,
      rationale:'Live-action/motion beat: real footage first, still image as factual fallback.'
    };
  }
  if(preference==='stock-image'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','stock-image','stock-video','generated-image'],
      syntheticAllowed:true,
      rationale:'Image-led beat: sourced still image first, generation allowed only after real-source gaps.'
    };
  }
  if(preference==='generated'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','generated-image'],
      syntheticAllowed:true,
      rationale:'Synthetic/illustrative beat: generation is an explicit editorial choice.'
    };
  }
  if(preference==='mixed'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','wikimedia','stock-video','stock-image','generated-image'],
      syntheticAllowed:true,
      rationale:'Mixed beat: exhaust reusable and real sources before generation.'
    };
  }

  return {
    sceneId:scene.id,beatId:beat?.id??null,preference,query,
    actions:['owned','stock-image','generated-image'],
    syntheticAllowed:true,
    rationale:'Legacy scene without an explicit source preference.'
  };
}
