import type {
  ProductionDNA, ProductionDnaCharacter, ScenePlan, SceneTimecode,
  VisualCharacterReference, VisualPromptSetPayload, VisualScenePrompt
} from '@/lib/types';

function camel(value:string){
  const parts=value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').match(/[A-Za-z0-9]+/g)??[];
  const result=parts.map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join('');
  return result||'Character';
}

export type ProductionNamingContext={
  channelCode:string;
  episodeNumber:number;
};

export function productionChannelCode(value:string){
  const compact=value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g,'')
    .slice(0,24);
  return compact||'CHANNEL';
}

export function productionFileStem(
  naming:ProductionNamingContext,
  sceneSequence:number,
  takeNumber=1
){
  return productionChannelCode(naming.channelCode)
    +'_V'+String(Math.max(1,Math.trunc(naming.episodeNumber))).padStart(2,'0')
    +'_S'+String(Math.max(1,Math.trunc(sceneSequence))).padStart(3,'0')
    +'_T'+String(Math.max(1,Math.trunc(takeNumber))).padStart(2,'0');
}

export function productionFileName(
  naming:ProductionNamingContext,
  sceneSequence:number,
  takeNumber=1,
  extension='mp4'
){
  return productionFileStem(naming,sceneSequence,takeNumber)+'.'+extension.replace(/^\./,'').toLowerCase();
}

export function visualTimecodeLabel(seconds:number){
  const whole=Math.max(0,Math.floor(seconds+1e-6));
  const minutes=Math.floor(whole/60);
  const secs=whole%60;
  return '#'+minutes+'-'+String(secs).padStart(2,'0');
}

export function recurringCharacterIds(
  scenes:Array<Pick<VisualScenePrompt,'sceneId'|'characterIds'>>
){
  const map=new Map<string,Set<string>>();
  for(const scene of scenes){
    for(const id of scene.characterIds){
      const set=map.get(id)??new Set<string>();
      set.add(scene.sceneId);
      map.set(id,set);
    }
  }
  return [...map.entries()].filter(([,sceneIds])=>sceneIds.size>=2).map(([id])=>id);
}

export function visualReferenceName(character:ProductionDnaCharacter){
  return '#'+camel(character.name||character.id);
}

export function compileCharacterReference(
  character:ProductionDnaCharacter,
  dna:ProductionDNA,
  sceneIds:string[]
):VisualCharacterReference{
  const styleLock=dna.visual.basePrompt.trim();
  const pieces=[
    'full-body reference character',
    character.description.trim(),
    ...character.visualRules,
    'full body visible from head to feet',
    'plain light background',
    ...character.forbidden.map(rule=>'avoid '+rule)
  ].map(item=>item.trim()).filter(Boolean);

  let prompt=pieces.join(', ');
  if(styleLock&&!prompt.endsWith(styleLock))prompt+=(prompt?', ':'')+styleLock;

  return {
    characterId:character.id,
    refName:visualReferenceName(character),
    prompt,
    sceneIds:[...new Set(sceneIds)],
    assetReady:false
  };
}

export function compileScenePrompt(
  scene:SceneTimecode,
  dna:ProductionDNA,
  characterIds:string[],
  direction:string,
  referenceCharacterIds:string[]=[],
  naming:ProductionNamingContext={channelCode:'CHANNEL',episodeNumber:1}
):VisualScenePrompt{
  const known=new Map(dna.characters.map(character=>[character.id,character]));
  const referenceSet=new Set(referenceCharacterIds);
  const references=characterIds
    .filter(id=>referenceSet.has(id))
    .map(id=>known.get(id))
    .filter((item):item is ProductionDnaCharacter=>!!item)
    .map(character=>'@'+visualReferenceName(character).slice(1));

  const styleLock=dna.visual.basePrompt.trim();
  const negative=dna.visual.negativePrompt.trim();
  const directionText=direction.trim()||scene.promptDirection.trim()||scene.visualIntent.trim()||scene.narration.trim();

  const pieces=[
    scene.shotType.trim(),
    references.join(', '),
    directionText,
    negative
  ].filter(Boolean);

  let prompt=pieces.join(', ').replace(/\s+/g,' ').trim();
  if(styleLock&&!prompt.endsWith(styleLock))prompt+=(prompt?', ':'')+styleLock;

  const takeNumber=1;
  const outputFileStem=productionFileStem(naming,scene.sequence,takeNumber);
  return {
    sceneId:scene.id,
    sequence:scene.sequence,
    timecodeLabel:visualTimecodeLabel(scene.startSeconds),
    startSeconds:scene.startSeconds,
    endSeconds:scene.endSeconds,
    characterIds:[...new Set(characterIds)],
    referenceNames:references,
    direction:directionText,
    prompt,
    outputFileStem,
    outputFileName:outputFileStem+'.mp4',
    takeNumber
  };
}

export function buildInitialVisualPromptSet(
  plan:ScenePlan,
  dna:ProductionDNA,
  naming:ProductionNamingContext={channelCode:'CHANNEL',episodeNumber:1}
):VisualPromptSetPayload{
  const now=new Date().toISOString();
  const recurring=recurringCharacterIds(plan.scenes.map(scene=>({sceneId:scene.id,characterIds:scene.characterIds})));
  const scenePrompts=plan.scenes.map(scene=>compileScenePrompt(
    scene,
    dna,
    scene.characterIds,
    scene.promptDirection||scene.visualIntent||scene.narration,
    recurring,
    naming
  ));
  const references=recurring.flatMap(characterId=>{
    const character=dna.characters.find(item=>item.id===characterId);
    if(!character)return [];
    return [compileCharacterReference(
      character,
      dna,
      scenePrompts.filter(scene=>scene.characterIds.includes(characterId)).map(scene=>scene.sceneId)
    )];
  });

  return {
    kind:'visual-prompt-set',
    id:crypto.randomUUID(),
    channelId:plan.channelId,
    episodeId:plan.episodeId,
    scenePlanId:plan.id,
    scenePlanVersion:plan.version,
    productionDnaVersion:dna.version,
    styleLock:dna.visual.basePrompt.trim(),
    productionNaming:{
      channelCode:productionChannelCode(naming.channelCode),
      episodeNumber:Math.max(1,Math.trunc(naming.episodeNumber)),
      takeDigits:2,
      pattern:'{CHANNEL}_V{VIDEO}_S{SCENE}_T{TAKE}.mp4'
    },
    workflowStage:references.length?'references':'scenes',
    characterReferences:references,
    scenePrompts,
    review:{notes:''},
    createdAt:now,
    updatedAt:now
  };
}

export function normalizeVisualPromptSet(payload:VisualPromptSetPayload){
  const naming=payload.productionNaming??{
    channelCode:'CHANNEL',
    episodeNumber:1,
    takeDigits:2,
    pattern:'{CHANNEL}_V{VIDEO}_S{SCENE}_T{TAKE}.mp4'
  };
  const normalizedNaming={
    channelCode:productionChannelCode(naming.channelCode),
    episodeNumber:Math.max(1,Math.trunc(naming.episodeNumber)),
    takeDigits:2,
    pattern:'{CHANNEL}_V{VIDEO}_S{SCENE}_T{TAKE}.mp4'
  };
  return {
    ...payload,
    productionNaming:normalizedNaming,
    characterReferences:payload.characterReferences.map(ref=>({
      ...ref,
      sceneIds:[...new Set(ref.sceneIds)]
    })),
    scenePrompts:[...payload.scenePrompts]
      .sort((a,b)=>a.sequence-b.sequence)
      .map((scene,index)=>{
        const sequence=index+1;
        const takeNumber=Math.max(1,Math.trunc(scene.takeNumber||1));
        const outputFileStem=productionFileStem(normalizedNaming,sequence,takeNumber);
        return {
          ...scene,
          sequence,
          takeNumber,
          outputFileStem,
          outputFileName:outputFileStem+'.mp4'
        };
      }),
    updatedAt:new Date().toISOString()
  };
}

export function visualPromptIssues(
  payload:VisualPromptSetPayload,
  plan:ScenePlan,
  dna:ProductionDNA,
  requireReadyReferences=true
){
  const issues:string[]=[];
  const knownCharacters=new Set(dna.characters.map(character=>character.id));
  const planSceneIds=plan.scenes.map(scene=>scene.id);
  const promptByScene=new Map(payload.scenePrompts.map(scene=>[scene.sceneId,scene]));
  const refByCharacter=new Map(payload.characterReferences.map(ref=>[ref.characterId,ref]));
  const recurring=recurringCharacterIds(payload.scenePrompts);

  if(payload.scenePlanVersion!==plan.version)issues.push('stale-scene-plan-version');
  if(payload.productionDnaVersion!==dna.version)issues.push('stale-production-dna-version');
  if(payload.styleLock!==dna.visual.basePrompt.trim())issues.push('style-lock-changed');
  if(payload.scenePrompts.length!==plan.scenes.length)issues.push('scene-prompt-count-mismatch');

  for(const scene of plan.scenes){
    const prompt=promptByScene.get(scene.id);
    if(!prompt){issues.push('missing-scene-prompt');continue;}
    if(prompt.timecodeLabel!==visualTimecodeLabel(scene.startSeconds))issues.push('timecode-label-mismatch');
    if(Math.abs(prompt.startSeconds-scene.startSeconds)>.02||Math.abs(prompt.endSeconds-scene.endSeconds)>.02)issues.push('scene-timecode-changed');
    if(!prompt.direction.trim()||!prompt.prompt.trim())issues.push('empty-scene-prompt');
    const expectedFile=productionFileName(payload.productionNaming,scene.sequence,prompt.takeNumber||1);
    if(prompt.outputFileName!==expectedFile||prompt.outputFileStem!==expectedFile.replace(/\.mp4$/,'')){
      issues.push('production-filename-mismatch');
    }
    if(payload.styleLock&&!prompt.prompt.endsWith(payload.styleLock))issues.push('style-lock-not-appended');
    for(const id of prompt.characterIds)if(!knownCharacters.has(id))issues.push('unknown-character');
  }

  for(const prompt of payload.scenePrompts){
    if(!planSceneIds.includes(prompt.sceneId))issues.push('extra-scene-prompt');
  }

  for(const characterId of recurring){
    const ref=refByCharacter.get(characterId);
    if(!ref){issues.push('missing-character-reference');continue;}
    if(requireReadyReferences&&!ref.assetReady)issues.push('character-reference-not-ready');
    const expected='@'+ref.refName.slice(1);
    for(const scene of payload.scenePrompts.filter(item=>item.characterIds.includes(characterId))){
      if(!scene.prompt.includes(expected))issues.push('missing-character-reference-token');
    }
  }

  for(const ref of payload.characterReferences){
    if(!knownCharacters.has(ref.characterId))issues.push('unknown-character-reference');
    if(!/^#[A-Za-z][A-Za-z0-9]*$/.test(ref.refName))issues.push('invalid-reference-name');
    if(!ref.prompt.trim())issues.push('empty-character-reference');
    if(payload.styleLock&&!ref.prompt.endsWith(payload.styleLock))issues.push('reference-style-lock-not-appended');
  }

  return [...new Set(issues)];
}
