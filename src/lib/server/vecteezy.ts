import 'server-only';

import { HttpError } from './auth';

export type VecteezyConfig={
  accountId:string;
  secretKey:string;
};

function clean(value:unknown){
  return typeof value==='string'?value.trim():'';
}

export function vecteezyConfigFromEnv():VecteezyConfig|null{
  const accountId=clean(process.env.VECTEEZY_ACCOUNT_ID);
  const secretKey=clean(process.env.VECTEEZY_SECRET_KEY);
  if(!accountId||!secretKey)return null;
  return {accountId,secretKey};
}

export function serializeVecteezyConfig(config:VecteezyConfig){
  return JSON.stringify({
    accountId:clean(config.accountId),
    secretKey:clean(config.secretKey)
  });
}

export function parseVecteezyConfig(secret:string):VecteezyConfig{
  let raw:unknown;
  try{raw=JSON.parse(secret);}catch{throw new HttpError('A configuração do Vecteezy está inválida.',500);}
  if(!raw||typeof raw!=='object')throw new HttpError('A configuração do Vecteezy está inválida.',500);
  const value=raw as Record<string,unknown>;
  const config:VecteezyConfig={
    accountId:clean(value.accountId),
    secretKey:clean(value.secretKey)
  };
  if(!/^\d+$/.test(config.accountId)||config.secretKey.length<8){
    throw new HttpError('A configuração do Vecteezy está incompleta.',500);
  }
  return config;
}

export function vecteezyHeaders(config:VecteezyConfig){
  return {Authorization:'Bearer '+config.secretKey};
}

export async function testVecteezyConfig(config:VecteezyConfig){
  let response:Response;
  try{
    response=await fetch(
      'https://api.vecteezy.com/v2/'+encodeURIComponent(config.accountId)+'/account/info?months=1',
      {
        headers:vecteezyHeaders(config),
        signal:AbortSignal.timeout(15000),
        cache:'no-store'
      }
    );
  }catch{
    throw new HttpError('Não foi possível alcançar a API do Vecteezy.',502);
  }
  if(response.status===401||response.status===403){
    throw new HttpError('O Vecteezy recusou o ID da conta ou a Chave Secreta.',422);
  }
  if(!response.ok){
    throw new HttpError('Não foi possível validar a conta do Vecteezy.',502);
  }
}
