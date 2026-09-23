import type { ProductionDnaPayload } from '@/lib/types';

function unique(items:string[]){
  return [...new Set(items.map(item=>item.trim()).filter(Boolean))];
}

export function productionDnaFormatIssues(dna:ProductionDnaPayload){
  const issues:string[]=[];
  const target=dna.format.targetDurationMinutes;
  if(target.min!==null&&target.max!==null&&target.min>target.max)issues.push('target-duration-min-greater-than-max');

  const scene=dna.format.sceneDurationSeconds;
  if(scene.min!==null&&scene.max!==null&&scene.min>scene.max)issues.push('scene-duration-min-greater-than-max');
  if(scene.preferred!==null&&scene.min!==null&&scene.preferred<scene.min)issues.push('scene-duration-preferred-below-min');
  if(scene.preferred!==null&&scene.max!==null&&scene.preferred>scene.max)issues.push('scene-duration-preferred-above-max');

  return issues;
}

export function buildProductionPrompt(
  dna:ProductionDnaPayload,
  sceneDirection:string,
  characterIds:string[]=[]
){
  const selected=dna.characters.filter(character=>characterIds.includes(character.id));
  const characterBible=selected.flatMap(character=>[
    character.description,
    ...character.visualRules
  ]).filter(Boolean).join(', ');

  const variables:Record<string,string>={
    scene_direction:sceneDirection.trim(),
    character_bible:characterBible,
    visual_bible:dna.visual.basePrompt.trim(),
    negative_rules:unique([
      dna.visual.negativePrompt,
      ...dna.visual.forbidden,
      ...selected.flatMap(character=>character.forbidden)
    ]).join(', '),
    aspect_ratio:dna.format.aspectRatio.trim()
  };

  const template=dna.visual.scenePromptTemplate.trim()||
    '{{scene_direction}} + {{character_bible}} + {{visual_bible}} + {{negative_rules}} + {{aspect_ratio}}';

  const composed=template.replace(/{{\s*([a-z_]+)\s*}}/g,(_match,key:string)=>variables[key]??'');
  const positivePrompt=composed
    .split('+')
    .map(part=>part.trim())
    .filter(Boolean)
    .join(', ')
    .replace(/,\s*,+/g,', ');

  return {
    positivePrompt,
    negativePrompt:variables.negative_rules,
    characterIds:selected.map(character=>character.id),
    aspectRatio:dna.format.aspectRatio
  };
}
