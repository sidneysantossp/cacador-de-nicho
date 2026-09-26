import 'server-only';

import { createHash } from 'node:crypto';
import { checked, db } from './db';
import { HttpError } from './auth';
import { providerSecret } from './providers';

const MODEL='gemini-embedding-001';
const DIMENSIONS=768;
const MAX_BATCH=32;

type EmbeddingTask='RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'|'SEMANTIC_SIMILARITY';

function hash(value:string){
  return createHash('sha256').update(value).digest('hex');
}

function vectorLiteral(values:number[]){
  return '['+values.map(value=>Number(value).toFixed(8)).join(',')+']';
}

function normalize(values:number[]){
  const clean=values.slice(0,DIMENSIONS).map(value=>Number.isFinite(Number(value))?Number(value):0);
  if(clean.length!==DIMENSIONS)throw new HttpError('O embedding não retornou 768 dimensões.',502);
  const norm=Math.sqrt(clean.reduce((sum,value)=>sum+value*value,0));
  if(!Number.isFinite(norm)||norm<=0)throw new HttpError('O embedding retornou vetor inválido.',502);
  return clean.map(value=>value/norm);
}

async function batchEmbed(input:Array<{text:string;title?:string}>,task:EmbeddingTask){
  if(!input.length)return [] as number[][];
  const key=await providerSecret('googleai');
  const endpoint='https://generativelanguage.googleapis.com/v1beta/models/'+MODEL+':batchEmbedContents';
  const output:number[][]=[];
  for(let offset=0;offset<input.length;offset+=MAX_BATCH){
    const batch=input.slice(offset,offset+MAX_BATCH);
    let response:Response;
    try{
      response=await fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json','x-goog-api-key':key},
        body:JSON.stringify({
          requests:batch.map(item=>({
            model:'models/'+MODEL,
            content:{parts:[{text:item.text.slice(0,12000)}]},
            embedContentConfig:{
              taskType:task,
              ...(task==='RETRIEVAL_DOCUMENT'&&item.title?{title:item.title.slice(0,220)}:{}),
              outputDimensionality:DIMENSIONS,
              autoTruncate:true
            }
          }))
        }),
        signal:AbortSignal.timeout(90000),
        cache:'no-store'
      });
    }catch{
      throw new HttpError('A Google AI excedeu o tempo ao gerar embeddings.',504);
    }
    if(response.status===429)throw new HttpError('A Google AI atingiu o limite ao gerar embeddings.',429);
    if(response.status===401||response.status===403)throw new HttpError('A Google AI recusou a credencial de embeddings.',422);
    if(!response.ok){
      const detail=(await response.text().catch(()=>'')).replace(/\s+/g,' ').slice(0,500);
      throw new HttpError('Falha ao gerar embeddings (HTTP '+response.status+')'+(detail?' · '+detail:''),502);
    }
    const body=await response.json() as {embeddings?:Array<{values?:number[]}>};
    const embeddings=body.embeddings??[];
    if(embeddings.length!==batch.length)throw new HttpError('A API de embeddings retornou lote incompleto.',502);
    output.push(...embeddings.map(item=>normalize(item.values??[])));
  }
  return output;
}

export async function indexOwnedMediaEmbeddings(input:{
  assetId:string;
  assetTitle:string;
  assetText:string;
  segments:Array<{id:string;title:string;searchText:string}>;
}){
  const documents=[
    {
      resourceType:'asset' as const,
      resourceId:input.assetId,
      title:input.assetTitle,
      text:input.assetText
    },
    ...input.segments.map(segment=>({
      resourceType:'segment' as const,
      resourceId:segment.id,
      title:segment.title,
      text:segment.searchText
    }))
  ].filter(item=>item.text.trim());

  if(!documents.length)return {indexed:0,model:MODEL,dimensions:DIMENSIONS};
  const embeddings=await batchEmbed(
    documents.map(item=>({text:item.text,title:item.title})),
    'RETRIEVAL_DOCUMENT'
  );
  const now=new Date().toISOString();
  checked(await db().from('radar_owned_media_embeddings').upsert(
    documents.map((item,index)=>({
      resource_type:item.resourceType,
      resource_id:item.resourceId,
      asset_id:input.assetId,
      model:MODEL,
      dimensions:DIMENSIONS,
      content_hash:hash(item.text),
      embedding:vectorLiteral(embeddings[index]),
      updated_at:now
    })),
    {onConflict:'resource_type,resource_id'}
  ));
  return {indexed:documents.length,model:MODEL,dimensions:DIMENSIONS};
}

export async function searchOwnedMediaEmbeddings(query:string,limit=80){
  const text=query.trim();
  if(text.length<3)return [] as Array<{
    resourceType:string;resourceId:string;assetId:string;similarity:number;
  }>;
  const [embedding]=await batchEmbed([{text}], 'RETRIEVAL_QUERY');
  const result=await db().rpc('match_owned_media_embeddings',{
    p_query_embedding:vectorLiteral(embedding),
    p_match_count:Math.max(1,Math.min(limit,200)),
    p_resource_type:'segment'
  });
  if(result.error)throw new HttpError('Falha ao pesquisar o índice semântico.',502);
  return (result.data??[]).map(row=>({
    resourceType:String(row.resource_type),
    resourceId:String(row.resource_id),
    assetId:String(row.asset_id),
    similarity:Math.max(0,Math.min(1,Number(row.similarity??0)))
  }));
}

export async function ownedMediaPairSimilarity(leftSegmentId:string,rightSegmentId:string){
  const result=await db().rpc('owned_media_embedding_similarity',{
    p_left_segment:leftSegmentId,
    p_right_segment:rightSegmentId
  });
  if(result.error)return null;
  const value=Number(result.data);
  return Number.isFinite(value)?Math.max(0,Math.min(1,value)):null;
}
