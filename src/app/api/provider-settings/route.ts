import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured, put, settings } from '@/lib/server/db';
import { modelSchema } from '@/lib/server/validation';
import { modelOptions } from '@/lib/models';
import {
  providerSecret, providerStatuses, removeProviderSecret, saveProviderSecret,
  saveR2ProviderConfig, saveVecteezyProviderConfig, testProvider
} from '@/lib/server/providers';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const provider=z.enum(['openai','youtube','elevenlabs','googleai','pexels','pixabay','unsplash','vecteezy','r2']);
const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('saveSecret'),provider,key:z.string().trim().min(8).max(1000)}).strict(),
  z.object({
    action:z.literal('saveR2'),
    accountId:z.string().trim().min(10).max(100),
    accessKeyId:z.string().trim().min(8).max(200),
    secretAccessKey:z.string().trim().min(16).max(500),
    bucket:z.string().trim().min(3).max(200),
    publicUrl:z.string().trim().max(1000).optional().default('')
  }).strict(),
  z.object({
    action:z.literal('saveVecteezy'),
    accountId:z.string().trim().regex(/^\d+$/).max(50),
    secretKey:z.string().trim().min(8).max(1000)
  }).strict(),
  z.object({action:z.literal('test'),provider}).strict(),
  z.object({action:z.literal('removeSecret'),provider}).strict(),
  z.object({action:z.literal('saveModels'),analysisModel:modelSchema,scriptModel:modelSchema}).strict(),
]);

async function payload(){
  const config=await settings();
  return {
    providers:await providerStatuses(),
    models:modelOptions,
    selection:{analysisModel:config.analysisModel,scriptModel:config.scriptModel}
  };
}

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para ver as credenciais.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para habilitar o cofre.',503);
    return Response.json(await payload(),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(Number(request.headers.get('content-length')??0)>7000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Confira os dados da configuração.');
    const body=parsed.data;

    if(body.action==='saveModels'){
      const current=await settings();
      await put('radar_settings','main',{...current,analysisModel:body.analysisModel,scriptModel:body.scriptModel});
      return Response.json({...await payload(),message:'Modelos da operação atualizados.'});
    }

    if(body.action==='saveR2'){
      await saveR2ProviderConfig({
        accountId:body.accountId,
        accessKeyId:body.accessKeyId,
        secretAccessKey:body.secretAccessKey,
        bucket:body.bucket,
        publicUrl:body.publicUrl||undefined
      });
      return Response.json({...await payload(),message:'Cloudflare R2 validado e salvo no cofre.'});
    }

    if(body.action==='saveVecteezy'){
      await saveVecteezyProviderConfig({accountId:body.accountId,secretKey:body.secretKey});
      return Response.json({...await payload(),message:'Vecteezy validado e salvo no cofre.'});
    }

    if(body.action==='removeSecret'){
      await removeProviderSecret(body.provider);
      return Response.json({...await payload(),message:'Credencial removida do cofre.'});
    }

    const key=body.action==='saveSecret'?body.key:await providerSecret(body.provider);
    const current=await settings();
    await testProvider(body.provider,key,current.analysisModel);
    if(body.action==='saveSecret')await saveProviderSecret(body.provider,key);
    return Response.json({
      ...await payload(),
      message:body.action==='saveSecret'?'Chave validada e salva no cofre.':'Conexão validada com sucesso.'
    });
  }catch(e){return errorResponse(e);}
}
