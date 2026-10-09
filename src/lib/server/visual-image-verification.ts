import 'server-only';

import OpenAI from 'openai';
import { z } from 'zod';
import { HttpError } from './auth';
import { providerSecret } from './providers';
import { withFactoryInstructions } from '@/lib/production-operating-system';
import type { SceneAssetVisualClass } from '@/lib/types';
import { googleVisionModelUnavailable, resolveGoogleVisionModel } from './google-vision-model';

export type ImageVerification={
  model:string;
  relevance:number;
  qualityScore:number;
  editorialUsefulness:number;
  summary:string;
  matchedEvidence:string[];
  mismatchReason:string;
  focusX:number;
  focusY:number;
  focusLabel:string;
  placeholderLike:boolean;
  templateLike:boolean;
  staticGraphic:boolean;
  visualClass:SceneAssetVisualClass;
  issues:string[];
};

export type VisualVerificationFrame={
  bytes:Buffer;
  mimeType:string;
  label?:string;
};

const visualClasses=[
  'live-footage','cinematic-scene','map','diagram','interface-card',
  'text-card','evidence-board','document','other'
] as const;

const imageVerificationSchema=z.object({
  relevance:z.number().min(0).max(1),
  qualityScore:z.number().min(0).max(1),
  editorialUsefulness:z.number().min(0).max(1),
  summary:z.string().max(1200),
  matchedEvidence:z.array(z.string()).max(20),
  mismatchReason:z.string().max(1200),
  focusX:z.number().min(0).max(1),
  focusY:z.number().min(0).max(1),
  focusLabel:z.string().max(240),
  placeholderLike:z.boolean(),
  templateLike:z.boolean(),
  staticGraphic:z.boolean(),
  visualClass:z.enum(visualClasses),
  issues:z.array(z.string().max(120)).max(20)
});

function verificationModel(){
  const configured=(process.env.VISUAL_IMAGE_VERIFICATION_MODEL??'').trim();
  const legacy=(process.env.VISUAL_INTELLIGENCE_MODEL??'').trim();
  return configured||(/^gpt-/i.test(legacy)?legacy:'gpt-5.6-luna');
}

function openAiError(error:unknown){
  const item=(error??{}) as {status?:number;name?:string;message?:string};
  const status=Number(item.status??0);
  const message=String(item.message??'').toLowerCase();
  if(status===401)return new HttpError('A OpenAI recusou a chave configurada para validação visual.',503);
  if(status===403)return new HttpError('A OpenAI recusou acesso ao modelo de validação visual configurado.',422);
  if(status===429)return new HttpError('A OpenAI atingiu o limite de uso durante a validação visual.',429);
  if(status===404||message.includes('model')&&message.includes('not found'))return new HttpError('O modelo de validação visual não está disponível nesta conta.',422);
  if(message.includes('timeout')||item.name?.toLowerCase().includes('timeout'))return new HttpError('A OpenAI excedeu o tempo durante a validação visual.',504);
  return new HttpError('A OpenAI falhou ao validar o asset visual candidato.',502);
}


const googleResponseSchema={
  type:'OBJECT',
  properties:{
    relevance:{type:'NUMBER'},
    qualityScore:{type:'NUMBER'},
    editorialUsefulness:{type:'NUMBER'},
    summary:{type:'STRING'},
    matchedEvidence:{type:'ARRAY',items:{type:'STRING'}},
    mismatchReason:{type:'STRING'},
    focusX:{type:'NUMBER'},
    focusY:{type:'NUMBER'},
    focusLabel:{type:'STRING'},
    placeholderLike:{type:'BOOLEAN'},
    templateLike:{type:'BOOLEAN'},
    staticGraphic:{type:'BOOLEAN'},
    visualClass:{type:'STRING',enum:[...visualClasses]},
    issues:{type:'ARRAY',items:{type:'STRING'}}
  },
  required:[
    'relevance','qualityScore','editorialUsefulness','summary','matchedEvidence',
    'mismatchReason','focusX','focusY','focusLabel','placeholderLike','templateLike',
    'staticGraphic','visualClass','issues'
  ]
} as const;

async function verifyVisualFramesWithGoogle(input:{
  frames:VisualVerificationFrame[];
  query:string;
  motionExpected?:boolean;
}):Promise<ImageVerification>{
  if(!input.frames.length)throw new HttpError('A validação visual não recebeu frames.',422);
  const key=await providerSecret('googleai');
  const parts:Array<Record<string,unknown>>=[{
    text:withFactoryInstructions([
      'You are the mandatory Pre-Render Visual QA reviewer for a professional YouTube production pipeline.',
      'Validate the supplied frame or ordered video frame samples against the editorial intent.',
      'Judge only what is visibly supported. Do not infer an exact person, place, event or date unless the frames support it.',
      'relevance is 0..1 for semantic match to the requested narration/visual intent.',
      'qualityScore is 0..1 for sharpness, framing, readability, compression, composition and production readiness.',
      'editorialUsefulness is 0..1 for whether this visual genuinely explains or advances the narration instead of merely filling screen time.',
      'placeholderLike=true for test cards, generic system-model slides, meaningless numbered graphics, obvious filler, unfinished templates or visuals whose main function is only to occupy runtime.',
      'templateLike=true when the composition looks like a generic reusable layout where labels/objects could be swapped with little loss of meaning. A purposeful diagram is not automatically template-like.',
      'staticGraphic=true when the supplied samples are predominantly the same graphic/slide/interface composition rather than meaningful live-action/cinematic progression. A legitimate diagram can still have high editorialUsefulness.',
      'For multiple ordered frames, compare START/MIDDLE/END progression. Do not call a video meaningful motion merely because text, a line, zoom or minor decorative elements move.',
      'visualClass must use exactly one allowed class.',
      'focusX and focusY are normalized 0..1 coordinates for the primary visible subject. Use 0.5,0.5 when centered or uncertain.',
      'issues contains short objective labels such as blur, low-contrast, generic-template, placeholder, weak-semantic-match, synthetic-artifact, text-heavy or static-graphic.',
      'EDITORIAL INTENT: '+input.query,
      'MOTION EXPECTED: '+(input.motionExpected===true?'yes':input.motionExpected===false?'no':'unknown'),
      'Return only the requested structured result.'
    ].join('\n'))
  }];
  input.frames.forEach((frame,index)=>{
    parts.push({text:'FRAME '+String(index+1)+' · '+(frame.label?.trim()||'sample')});
    parts.push({inline_data:{
      mime_type:frame.mimeType||'image/jpeg',
      data:frame.bytes.toString('base64')
    }});
  });

  const call=async(model:string)=>{
    let response:Response;
    try{
      response=await fetch(
        'https://generativelanguage.googleapis.com/v1beta/'+model+':generateContent',
        {
          method:'POST',
          headers:{'Content-Type':'application/json','x-goog-api-key':key},
          body:JSON.stringify({
            contents:[{role:'user',parts}],
            generationConfig:{
              temperature:.1,
              responseMimeType:'application/json',
              responseSchema:googleResponseSchema
            }
          }),
          signal:AbortSignal.timeout(90000),
          cache:'no-store'
        }
      );
    }catch{
      throw new HttpError('A Google AI excedeu o tempo durante a validação visual.',504);
    }
    if(response.status===429)throw new HttpError('A Google AI atingiu quota ou limite durante a validação visual.',429);
    if(response.status===401||response.status===403)throw new HttpError('A Google AI recusou a credencial para validação visual.',422);
    if(!response.ok){
      const detail=(await response.text().catch(()=>'')).replace(/\s+/g,' ').slice(0,500);
      throw new HttpError(
        'A Google AI falhou durante a validação visual (HTTP '+response.status+')'+
        (detail?' · '+detail:''),
        response.status===404||response.status===503?503:502
      );
    }
    const body=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>} ;
    const raw=(body.candidates?.[0]?.content?.parts??[]).map(item=>item.text??'').join('').trim();
    if(!raw)throw new HttpError('A Google AI não retornou resultado para validação visual.',502);
    let parsed:unknown;
    try{parsed=JSON.parse(raw);}
    catch{throw new HttpError('A Google AI devolveu JSON inválido na validação visual.',502);}
    return {...imageVerificationSchema.parse(parsed),model:'googleai:'+model};
  };

  const primary=await resolveGoogleVisionModel(key);
  try{
    return await call(primary);
  }catch(error){
    if(!googleVisionModelUnavailable(error))throw error;
    const fallback=await resolveGoogleVisionModel(key,{forceRefresh:true,excludeModel:primary});
    if(!fallback||fallback===primary)throw error;
    return call(fallback);
  }
}

function visualQaProviderFailure(error:unknown){
  if(!(error instanceof HttpError||error instanceof Error))return false;
  const status=error instanceof HttpError?error.status:0;
  const message=error.message.toLowerCase();
  return [401,403,404,422,429,502,503,504].includes(status)||
    message.includes('quota')||
    message.includes('limite')||
    message.includes('timeout')||
    message.includes('modelo')||
    message.includes('model')||
    message.includes('credencial')||
    message.includes('chave')||
    message.includes('indispon');
}

async function verifyVisualFramesPrimary(input:{
  frames:VisualVerificationFrame[];
  query:string;
  motionExpected?:boolean;
}):Promise<ImageVerification>{
  if(!input.frames.length)throw new HttpError('A validação visual não recebeu frames.',422);
  const key=await providerSecret('openai');
  const client=new OpenAI({apiKey:key,timeout:90000,maxRetries:1});
  const model=verificationModel();
  const content:Array<Record<string,unknown>>=[{
    type:'input_text',
    text:[
      'EDITORIAL INTENT: '+input.query,
      'MOTION EXPECTED: '+(input.motionExpected===true?'yes':input.motionExpected===false?'no':'unknown')
    ].join('\n')
  }];
  input.frames.forEach((frame,index)=>{
    content.push({
      type:'input_text',
      text:'FRAME '+String(index+1)+' · '+(frame.label?.trim()||'sample')
    });
    content.push({
      type:'input_image',
      image_url:'data:'+(frame.mimeType||'image/jpeg')+';base64,'+frame.bytes.toString('base64'),
      detail:'high'
    });
  });

  try{
    const response=await client.responses.parse({
      model,
      store:false,
      instructions:withFactoryInstructions([
        'You are the mandatory Pre-Render Visual QA reviewer for a professional YouTube production pipeline.',
        'Validate the supplied frame or ordered video frame samples against the editorial intent.',
        'Judge only what is visibly supported. Do not infer an exact person, place, event or date unless the frames support it.',
        'relevance is 0..1 for semantic match to the requested narration/visual intent.',
        'qualityScore is 0..1 for sharpness, framing, readability, compression, composition and production readiness.',
        'editorialUsefulness is 0..1 for whether this visual genuinely explains or advances the narration instead of merely filling screen time.',
        'placeholderLike=true for test cards, generic system-model slides, meaningless numbered graphics, obvious filler, unfinished templates or visuals whose main function is only to occupy runtime.',
        'templateLike=true when the composition looks like a generic reusable layout where labels/objects could be swapped with little loss of meaning. A purposeful diagram is not automatically template-like.',
        'staticGraphic=true when the supplied samples are predominantly the same graphic/slide/interface composition rather than meaningful live-action/cinematic progression. A legitimate diagram can still have high editorialUsefulness.',
        'For multiple ordered frames, compare START/MIDDLE/END progression. Do not call a video meaningful motion merely because text, a line, zoom or minor decorative elements move.',
        'visualClass must use exactly one allowed class.',
        'focusX and focusY are normalized 0..1 coordinates for the primary visible subject. Use 0.5,0.5 when centered or uncertain.',
        'issues contains short objective labels such as blur, low-contrast, generic-template, placeholder, weak-semantic-match, synthetic-artifact, text-heavy or static-graphic.',
        'Return only the requested structured result.'
      ].join('\n')),
      input:[{role:'user',content:content as never}],
      text:{format:{type:'json_schema',name:'visual_verification',strict:true,schema:{
        type:'object',
        properties:{
          relevance:{type:'number',minimum:0,maximum:1},
          qualityScore:{type:'number',minimum:0,maximum:1},
          editorialUsefulness:{type:'number',minimum:0,maximum:1},
          summary:{type:'string'},
          matchedEvidence:{type:'array',items:{type:'string'}},
          mismatchReason:{type:'string'},
          focusX:{type:'number',minimum:0,maximum:1},
          focusY:{type:'number',minimum:0,maximum:1},
          focusLabel:{type:'string'},
          placeholderLike:{type:'boolean'},
          templateLike:{type:'boolean'},
          staticGraphic:{type:'boolean'},
          visualClass:{type:'string',enum:[...visualClasses]},
          issues:{type:'array',items:{type:'string'}}
        },
        required:[
          'relevance','qualityScore','editorialUsefulness','summary','matchedEvidence',
          'mismatchReason','focusX','focusY','focusLabel','placeholderLike','templateLike',
          'staticGraphic','visualClass','issues'
        ],
        additionalProperties:false
      }}},
      max_output_tokens:2400,
      prompt_cache_options:{mode:'explicit'}
    });
    const parsed=response.output_text?.trim();
    if(!parsed)throw new HttpError('A validação visual não retornou resultado.',502);
    return {...imageVerificationSchema.parse(JSON.parse(parsed)),model};
  }catch(error){
    if(error instanceof HttpError)throw error;
    try{
      const parsed=imageVerificationSchema.parse(JSON.parse(String((error as {message?:string})?.message??'')));
      return {...parsed,model};
    }catch{
      throw openAiError(error);
    }
  }
}


export async function verifyVisualFramesWithOpenAI(input:{
  frames:VisualVerificationFrame[];
  query:string;
  motionExpected?:boolean;
}):Promise<ImageVerification>{
  try{
    return await verifyVisualFramesPrimary(input);
  }catch(error){
    if(!visualQaProviderFailure(error))throw error;
    return verifyVisualFramesWithGoogle(input);
  }
}

export async function verifyStillImageWithOpenAI(input:{
  bytes:Buffer;
  mimeType:string;
  query:string;
}):Promise<ImageVerification>{
  return verifyVisualFramesWithOpenAI({
    frames:[{bytes:input.bytes,mimeType:input.mimeType,label:'STILL'}],
    query:input.query,
    motionExpected:false
  });
}
