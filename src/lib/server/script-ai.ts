import 'server-only';

import OpenAI from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import type {
  ChannelBrain, ChannelEpisode, ContentProject, EpisodeScriptPayload,
  EpisodeScriptSection, ManagedChannel, ProductionDNA
} from '@/lib/types';
import { settings } from './db';
import { providerSecret } from './providers';
import { HttpError } from './auth';

const sectionSchema=z.object({
  label:z.string(),
  purpose:z.string(),
  content:z.string(),
  claimIds:z.array(z.string().uuid()).max(100)
});

const draftSchema=z.object({
  title:z.string(),
  sections:z.array(sectionSchema).min(2).max(24),
  continuityNotes:z.array(z.string()).max(20),
  factCheckWarnings:z.array(z.string()).max(30)
});

const sectionRewriteSchema=z.object({
  purpose:z.string(),
  content:z.string(),
  claimIds:z.array(z.string().uuid()).max(100),
  factCheckWarnings:z.array(z.string()).max(20)
});

async function client(){
  return new OpenAI({apiKey:await providerSecret('openai'),timeout:120000,maxRetries:1});
}

type OpenAIErrorLike={status?:number;name?:string;message?:string};

function scriptAiError(error:unknown,stage:string){
  if(error instanceof HttpError)return error;
  const item=(error??{}) as OpenAIErrorLike;
  const status=Number(item.status??0);
  const message=String(item.message??'').toLowerCase();
  if(status===401)return new HttpError('A OpenAI recusou a chave configurada. Teste a credencial em Configurações.',503);
  if(status===429)return new HttpError('A OpenAI está sem quota ou atingiu o limite de uso. O projeto continua salvo e pode ser editado/importado manualmente.',429);
  if(status===403)return new HttpError('A conta não possui acesso ao modelo configurado para roteiros.',422);
  if(status===404||(message.includes('model')&&message.includes('not found')))return new HttpError('O modelo configurado para roteiros não está disponível nesta conta.',422);
  if(message.includes('timeout')||item.name?.toLowerCase().includes('timeout'))return new HttpError('A OpenAI excedeu o tempo limite durante '+stage+'.',504);
  return new HttpError('A OpenAI falhou durante '+stage+'. O projeto foi preservado.',502);
}

export type OwnedScriptContext={
  channel:ManagedChannel;
  brain:ChannelBrain|null;
  episode:ChannelEpisode;
  project:ContentProject;
  productionDna:ProductionDNA|null;
};

function compactContext(input:OwnedScriptContext){
  const sourceById=new Map(input.project.research.sources.map(source=>[source.id,source]));
  const supportedClaims=input.project.research.factChecks
    .filter(item=>item.status==='supported')
    .map(item=>({
      id:item.id,
      claim:item.claim,
      claimType:item.claimType??'fact',
      narrationRule:item.narrationRule??'assert',
      notes:item.notes,
      sources:item.sourceIds.map(id=>sourceById.get(id)).filter(Boolean).map(source=>({
        id:source!.id,title:source!.title,url:source!.url,
        sourceType:source!.sourceType,origin:source!.origin??null,role:source!.role??null
      }))
    }));

  return {
    channel:{
      name:input.channel.name,
      niche:input.channel.niche,
      format:input.channel.format,
      description:input.channel.description
    },
    constitution:input.brain?.constitution??null,
    narrative:input.brain?.narrative??null,
    characters:input.brain?.characters??[],
    learnings:input.brain?.learnings??[],
    episode:{
      title:input.episode.title,
      thesis:input.episode.thesis,
      narrativeSummary:input.episode.narrativeSummary,
      prerequisiteConcepts:input.episode.prerequisiteConcepts,
      introducesConcepts:input.episode.introducesConcepts,
      reinforcesConcepts:input.episode.reinforcesConcepts,
      opensThreads:input.episode.opensThreads,
      resolvesThreads:input.episode.resolvesThreads,
      repetitionKeys:input.episode.repetitionKeys
    },
    brief:input.project.brief,
    research:{
      notes:input.project.research.notes,
      sources:input.project.research.sources.map(source=>({
        id:source.id,
        title:source.title,
        url:source.url,
        sourceType:source.sourceType,
        origin:source.origin??null,
        role:source.role??null,
        claim:source.claim
      })),
      researchPack:input.project.research.pack?{
        question:input.project.research.pack.question,
        storyAngle:input.project.research.pack.storyAngle,
        entities:input.project.research.pack.entities,
        timeline:input.project.research.pack.timeline,
        audienceSignals:input.project.research.pack.audienceSignals.map(item=>({
          ...item,
          evidenceClass:'anecdotal-editorial-signal'
        }))
      }:null,
      supportedClaims
    },
    production:{
      targetDurationMinutes:input.productionDna?.format.targetDurationMinutes??null,
      narrationLanguage:input.productionDna?.voice.language??'English',
      narrationStyle:input.productionDna?.voice.narrationStyle??[],
      paceWpm:input.productionDna?.voice.paceWpm??null,
      documentaryMode:input.productionDna?.research?.documentaryMode??false,
      requireClaimLedger:input.productionDna?.research?.requireClaimLedger??false
    }
  };
}

const instructions='You are the Script Engine for Caçadores de Nichos. Write the audience-facing script in ENGLISH unless the Production DNA explicitly defines another narration language. The output is narration only. Do not write storyboard directions, camera instructions, scene prompts, production notes, timestamps or markdown headings inside section content. Preserve the channel constitution, worldview, character knowledge, established metaphors, narrative continuity, open threads and do-not-repeat rules. Do not make a character know a concept before the supplied narrative state allows it. Use the approved Content Project as the editorial contract. Do not change its thesis, angle, promise or audience merely to make writing easier. Use factual claims only when supported by the supplied research/fact-check context. Each section must return claimIds containing ONLY the UUIDs of supportedClaims actually used in that section. Never invent claim IDs. Research Pack timeline and audience signals are planning context, not independent factual proof; audience signals from Reddit/community remain anecdotal unless the same claim appears in supportedClaims. Obey each supported claim's narrationRule: assert may be stated directly; qualify must explicitly signal uncertainty with language such as about, approximately, estimated, likely or believed; attribute must name or clearly attribute the source/record/report; exclude must not appear in narration. A claimType of allegation must be attributed. A claimType of folklore must be framed as legend, tradition, story or belief, never as established fact. If a useful factual claim is not supported, either omit it or mark it explicitly with [VERIFY] and include a factCheckWarning. Do not invent sources, statistics, quotations, studies, previous episode events or audience feedback. Avoid generic filler and repeated explanations. Each section must have a clear narrative purpose. The final content should feel like one continuous narration even though it is stored in editable sections.';

export async function generateOwnedChannelScript(input:OwnedScriptContext){
  const config=await settings();
  try{
    const response=await (await client()).responses.parse({
      model:config.scriptModel,
      store:false,
      instructions,
      input:JSON.stringify({
        task:'Write a complete original episode script from the approved Content Project. Use sections that are independently editable while preserving one continuous narrative. When the channel has an ongoing character or narrative arc, make the episode feel like a logical evolution rather than a reset.',
        context:compactContext(input)
      }),
      text:{format:zodTextFormat(draftSchema,'owned_episode_script')},
      max_output_tokens:12000
    });
    if(!response.output_parsed)throw new HttpError('A geração do roteiro ficou incompleta. Tente novamente.',502);
    const parsed=draftSchema.parse(response.output_parsed);
    return {
      model:config.scriptModel,
      title:parsed.title,
      sections:parsed.sections.map((section,index):EpisodeScriptSection=>({
        id:crypto.randomUUID(),
        label:section.label||('Section '+(index+1)),
        purpose:section.purpose,
        content:section.content,
        claimIds:section.claimIds
      })),
      continuityNotes:parsed.continuityNotes,
      factCheckWarnings:parsed.factCheckWarnings
    };
  }catch(error){throw scriptAiError(error,'a geração do roteiro');}
}

export async function regenerateOwnedScriptSection(
  input:OwnedScriptContext,
  script:EpisodeScriptPayload,
  sectionId:string
){
  const target=script.sections.find(section=>section.id===sectionId);
  if(!target)throw new HttpError('Trecho do roteiro não encontrado.',404);
  const config=await settings();

  try{
    const response=await (await client()).responses.parse({
      model:config.scriptModel,
      store:false,
      instructions,
      input:JSON.stringify({
        task:'Rewrite ONLY the target section. Preserve all other sections exactly as they are. The rewritten section must connect naturally to the section before and after it, keep the same editorial thesis, and obey the same factual constraints.',
        context:compactContext(input),
        currentScript:{
          title:script.title,
          sections:script.sections.map(section=>({
            id:section.id,
            label:section.label,
            purpose:section.purpose,
            content:section.content,
            claimIds:section.claimIds??[]
          }))
        },
        targetSectionId:sectionId
      }),
      text:{format:zodTextFormat(sectionRewriteSchema,'owned_script_section_rewrite')},
      max_output_tokens:4000
    });
    if(!response.output_parsed)throw new HttpError('A regeneração do trecho ficou incompleta.',502);
    return {model:config.scriptModel,...sectionRewriteSchema.parse(response.output_parsed)};
  }catch(error){throw scriptAiError(error,'a regeneração do trecho');}
}
