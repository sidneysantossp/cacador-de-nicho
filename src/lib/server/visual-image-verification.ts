import 'server-only';

import OpenAI from 'openai';
import { z } from 'zod';
import { HttpError } from './auth';
import { providerSecret } from './providers';

export type ImageVerification={
  relevance:number;
  summary:string;
  matchedEvidence:string[];
  mismatchReason:string;
  focusX:number;
  focusY:number;
  focusLabel:string;
};

const imageVerificationSchema=z.object({
  relevance:z.number().min(0).max(1),
  summary:z.string().max(1200),
  matchedEvidence:z.array(z.string()).max(20),
  mismatchReason:z.string().max(1200),
  focusX:z.number().min(0).max(1),
  focusY:z.number().min(0).max(1),
  focusLabel:z.string().max(240)
});

function openAiError(error:unknown){
  const item=(error??{}) as {status?:number;name?:string;message?:string};
  const status=Number(item.status??0);
  const message=String(item.message??'').toLowerCase();
  if(status===401)return new HttpError('A OpenAI recusou a chave configurada para validação visual.',503);
  if(status===403)return new HttpError('A OpenAI recusou acesso ao modelo de validação visual configurado.',422);
  if(status===429)return new HttpError('A OpenAI atingiu o limite de uso durante a validação visual.',429);
  if(status===404||message.includes('model')&&message.includes('not found'))return new HttpError('O modelo de validação visual não está disponível nesta conta.',422);
  if(message.includes('timeout')||item.name?.toLowerCase().includes('timeout'))return new HttpError('A OpenAI excedeu o tempo durante a validação visual.',504);
  return new HttpError('A OpenAI falhou ao validar a imagem candidata.',502);
}

export async function verifyStillImageWithOpenAI(input:{bytes:Buffer;mimeType:string;query:string}):Promise<ImageVerification>{
  const key=await providerSecret('openai');
  const client=new OpenAI({apiKey:key,timeout:90000,maxRetries:1});
  const model=(process.env.VISUAL_INTELLIGENCE_MODEL??'gpt-5.6-luna').trim();
  const imageUrl='data:'+(input.mimeType||'image/jpeg')+';base64,'+input.bytes.toString('base64');
  try{
    const response=await client.responses.parse({
      model,
      store:false,
      instructions:[
        'Validate this candidate image against the editorial visual intent below.',
        'Judge only what is visibly supported. Do not infer an exact person, place, event or date unless visual evidence supports it.',
        'relevance is 0..1. Use high scores only when the image clearly satisfies the requested subject and context.',
        'focusX and focusY are normalized 0..1 coordinates for the center of the primary visible subject relevant to the editorial intent.',
        'Use 0.5,0.5 when the relevant subject is centered or no safer focal point is visible. focusLabel names the visible subject used as focus.',
        'Return only the requested structured result.'
      ].join('\\n'),
      input:[{role:'user',content:[
        {type:'input_text',text:'EDITORIAL INTENT: '+input.query},
        {type:'input_image',image_url:imageUrl,detail:'high'}
      ]}],
      text:{format:{type:'json_schema',name:'image_verification',strict:true,schema:{
        type:'object',
        properties:{
          relevance:{type:'number',minimum:0,maximum:1},
          summary:{type:'string'},
          matchedEvidence:{type:'array',items:{type:'string'}},
          mismatchReason:{type:'string'},
          focusX:{type:'number',minimum:0,maximum:1},
          focusY:{type:'number',minimum:0,maximum:1},
          focusLabel:{type:'string'}
        },
        required:['relevance','summary','matchedEvidence','mismatchReason','focusX','focusY','focusLabel'],
        additionalProperties:false
      }}},
      max_output_tokens:1800,
      prompt_cache_options:{mode:'explicit'}
    });
    const parsed=response.output_text?.trim();
    if(!parsed)throw new HttpError('A validação visual não retornou resultado.',502);
    return imageVerificationSchema.parse(JSON.parse(parsed));
  }catch(error){
    if(error instanceof HttpError)throw error;
    try{ return imageVerificationSchema.parse(JSON.parse(String((error as {message?:string})?.message??''))); }
    catch{ throw openAiError(error); }
  }
}
