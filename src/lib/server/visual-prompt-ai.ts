import 'server-only';

import OpenAI from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import type { ProductionDNA, ScenePlan } from '@/lib/types';
import { settings } from './db';
import { providerSecret } from './providers';
import { HttpError } from './auth';

const sceneDraft=z.object({
  sceneId:z.string().uuid(),
  characterIds:z.array(z.string()).max(20),
  shotType:z.string(),
  direction:z.string()
});

async function client(){
  return new OpenAI({apiKey:await providerSecret('openai'),timeout:120000,maxRetries:1});
}

type ErrorLike={status?:number;message?:string;name?:string};

function visualAiError(error:unknown){
  if(error instanceof HttpError)return error;
  const item=(error??{}) as ErrorLike;
  const message=String(item.message??'').toLowerCase();
  const status=Number(item.status??0);
  if(status===401)return new HttpError('A OpenAI recusou a chave configurada.',503);
  if(status===429)return new HttpError('A OpenAI atingiu o limite de uso. O Visual Prompt Engine continua editável manualmente.',429);
  if(status===403||status===404)return new HttpError('O modelo configurado não está disponível para o Visual Prompt Engine.',422);
  if(message.includes('timeout')||item.name?.toLowerCase().includes('timeout'))return new HttpError('A OpenAI excedeu o tempo para planejar os visuais.',504);
  return new HttpError('A OpenAI falhou ao planejar os prompts visuais.',502);
}

export async function draftVisualScenes(plan:ScenePlan,dna:ProductionDNA){
  const config=await settings();
  const knownCharacters=dna.characters.map(character=>({
    id:character.id,
    name:character.name,
    description:character.description
  }));

  const batches=[];
  for(let i=0;i<plan.scenes.length;i+=40)batches.push(plan.scenes.slice(i,i+40));
  const output:Array<{sceneId:string;characterIds:string[];shotType:string;direction:string}>=[];

  for(const batch of batches){
    try{
      const response=await (await client()).responses.parse({
        model:config.analysisModel,
        store:false,
        instructions:[
          'You are the Visual Planner for Caçadores de Nichos.',
          'Return exactly one record for every supplied scene and never create, delete, split, merge or reorder timecodes.',
          'sceneId must be copied exactly from input.',
          'characterIds may contain ONLY IDs from knownCharacters. Use a character ID only when that specific recurring character is genuinely present in the narration/visual beat.',
          'Do not create character IDs for generic crowds, one-off unnamed people, animals or background figures.',
          'shotType is a short framing label such as wide shot, medium shot, close-up, overhead, or simple diagram.',
          'direction describes only the visual action, environment, objects and composition needed for the narration.',
          'Do NOT describe the recurring character appearance; later stages use @Name references.',
          'Do NOT include style language, aspect ratio, negative prompts, model names, timecodes, markdown or filenames in direction.',
          'Prefer one clear visual idea per scene. Avoid adding facts that are not in the narration or supplied context.'
        ].join(' '),
        input:JSON.stringify({
          knownCharacters,
          visualStyle:dna.visual.styleDescription,
          compositionRules:dna.visual.compositionRules,
          cameraRules:dna.visual.cameraRules,
          scenes:batch.map(scene=>({
            sceneId:scene.id,
            narration:scene.narration,
            visualIntent:scene.visualIntent,
            shotType:scene.shotType,
            existingCharacterIds:scene.characterIds,
            promptDirection:scene.promptDirection
          }))
        }),
        text:{format:zodTextFormat(z.object({scenes:z.array(sceneDraft).min(1).max(40)}),'visual_scene_drafts')},
        max_output_tokens:7000
      });
      if(!response.output_parsed)throw new HttpError('O planejamento visual retornou vazio.',502);
      output.push(...response.output_parsed.scenes);
    }catch(error){throw visualAiError(error);}
  }

  const byId=new Map(output.map(item=>[item.sceneId,item]));
  const allowed=new Set(dna.characters.map(character=>character.id));
  return plan.scenes.map(scene=>{
    const item=byId.get(scene.id);
    if(!item)return {
      sceneId:scene.id,
      characterIds:scene.characterIds.filter(id=>allowed.has(id)),
      shotType:scene.shotType,
      direction:scene.promptDirection||scene.visualIntent||scene.narration
    };
    return {
      sceneId:scene.id,
      characterIds:[...new Set(item.characterIds.filter(id=>allowed.has(id)))],
      shotType:item.shotType.trim()||scene.shotType,
      direction:item.direction.trim()||scene.promptDirection||scene.visualIntent||scene.narration
    };
  });
}
