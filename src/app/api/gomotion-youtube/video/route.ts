import { bridgeSecretValid, scopedYoutubeChannel } from '@/lib/gomotion-bridge-policy';
import {
 makeVideoEditPreview, normalizedVideoState, validateYouTubeVideoId, verifyVideoEditPreview
} from '@/lib/youtube-video-edit-policy';
import type { VideoEditState } from '@/lib/youtube-video-edit-policy';
import { HttpError, errorResponse } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
 listLinkedYouTubeChannels, loadLinkedYouTubeConnectionSecret, refreshYouTubeAccessToken
} from '@/lib/server/youtube-oauth';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

type OwnedVideo={id:string;snippet:{
 channelId?:string;title?:string;description?:string;tags?:string[];categoryId?:string;
 defaultLanguage?:string;thumbnails?:Record<string,{url?:string}>;
};status?:{privacyStatus?:string};};
const API_BASE='https://www.googleapis.com/youtube/v3/videos';

function bridgeAuth(request:Request){
 const secret=process.env.GOMOTION_BRIDGE_SECRET?.trim()??'';
 const id=process.env.GOMOTION_BRIDGE_YOUTUBE_CHANNEL_ID?.trim()??'';
 if(secret.length<32||!/^UC[A-Za-z0-9_-]{22}$/.test(id))throw new HttpError('Ponte YouTube não configurada.',503);
 if(!bridgeSecretValid(request.headers.get('x-gomotion-bridge-secret'),secret))throw new HttpError('Acesso negado.',401);
 return {secret,channelId:id};
}
async function ownedAccess(request:Request){
 const {secret,channelId}=bridgeAuth(request);
 if(!dbConfigured())throw new HttpError('Conexão com o banco indisponível.',503);
 const channel=scopedYoutubeChannel(await listLinkedYouTubeChannels(),channelId);
 if(!channel||channel.status!=='connected')throw new HttpError('Canal não está conectado no Caçadores.',409);
 const required='https://www.googleapis.com/auth/youtube.force-ssl';
 if(!channel.scopes.includes(required))throw new HttpError('Reconecte o canal com permissão para editar vídeos.',409);
 const connection=await loadLinkedYouTubeConnectionSecret(channel.id);
 const token=await refreshYouTubeAccessToken(connection.refreshToken);
 if(!token.access_token)throw new HttpError('Não foi possível renovar o acesso ao YouTube.',502);
 return {secret,channelId,accessToken:token.access_token};
}
async function youtubeJson(url:string,accessToken:string,init?:RequestInit){
 const response=await fetch(url,{
  ...init,
  headers:{'Authorization':'Bearer '+accessToken,'Accept':'application/json',...(init?.headers??{})},
  cache:'no-store',
  signal:AbortSignal.timeout(30000)
 });
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw new HttpError('YouTube não aceitou a operação (HTTP '+response.status+').',502);
 return payload;
}
async function getVideo(id:string,accessToken:string,expectedChannelId:string):Promise<OwnedVideo>{
 const url=new URL(API_BASE);url.searchParams.set('part','snippet,status');url.searchParams.set('id',id);
 const payload=await youtubeJson(url.toString(),accessToken);
 const video=(payload.items??[])[0] as OwnedVideo|undefined;
 if(!video?.id||video.snippet?.channelId!==expectedChannelId)throw new HttpError('Vídeo não pertence ao canal conectado.',404);
 if(!video.snippet.title||!video.snippet.categoryId)throw new HttpError('Metadados incompletos para edição segura.',409);
 return video;
}
function editable(video:OwnedVideo):VideoEditState{
 return normalizedVideoState({
  title:video.snippet.title??'',description:video.snippet.description??'',
  tags:video.snippet.tags??[],categoryId:video.snippet.categoryId??'',
  defaultLanguage:video.snippet.defaultLanguage
 });
}
function publicVideo(video:OwnedVideo){
 return {videoId:video.id,videoUrl:'https://www.youtube.com/watch?v='+video.id,
  title:video.snippet.title??'',description:video.snippet.description??'',
  tags:video.snippet.tags??[],categoryId:video.snippet.categoryId??'',
  defaultLanguage:video.snippet.defaultLanguage??null,
  privacyStatus:video.status?.privacyStatus??'unknown',
  thumbnailUrl:video.snippet.thumbnails?.high?.url??video.snippet.thumbnails?.default?.url??null
 };
}
function validId(value:unknown){
 try{return validateYouTubeVideoId(value);}catch{throw new HttpError('ID de vídeo inválido.',400);}
}
export async function GET(request:Request){
 try{
  const id=validId(new URL(request.url).searchParams.get('videoId'));
  const auth=await ownedAccess(request);
  return Response.json({schema:'gomotion-youtube-video-v1',video:publicVideo(await getVideo(id,auth.accessToken,auth.channelId))},{
   headers:{'Cache-Control':'no-store'}
  });
 }catch(error){return errorResponse(error);}
}
export async function POST(request:Request){
 try{
  const size=Number(request.headers.get('content-length')??0);
  if(size>30000)throw new HttpError('Requisição excessiva.',413);
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError('Solicitação inválida.',400);
  if(Object.keys(body).some(k=>!['action','videoId','patch','confirmationToken','confirmation'].includes(k)))
   throw new HttpError('Campos não permitidos.',400);
  const id=validId(body.videoId);
  if(body.action!=='preview'&&body.action!=='apply')throw new HttpError('Ação não permitida.',400);
  const auth=await ownedAccess(request);
  const beforeVideo=await getVideo(id,auth.accessToken,auth.channelId);
  const before=editable(beforeVideo);
  if(body.action==='preview'){
   let preview;
   try{preview=makeVideoEditPreview(id,auth.channelId,before,body.patch,auth.secret);}
   catch{throw new HttpError('Reveja o título, descrição ou tags. Nenhum campo foi modificado.',400);}
   return Response.json({schema:'gomotion-youtube-edit-preview-v1',videoId:id,
    before:preview.before,after:preview.after,confirmationToken:preview.confirmationToken,
    expiresAt:preview.expiresAt,requiresConfirmation:true,
    untouched:['privacyStatus','publishAt','file','thumbnail','audience']},{headers:{'Cache-Control':'no-store'}});
  }
  if(body.confirmation!=='CONFIRMO_ALTERAR_VIDEO')throw new HttpError('Confirmação explícita obrigatória.',409);
  if(typeof body.confirmationToken!=='string')throw new HttpError('Prévia obrigatória.',409);
  let after:VideoEditState;
  try{after=verifyVideoEditPreview(body.confirmationToken,id,auth.channelId,before,auth.secret);}
  catch{throw new HttpError('Prévia expirou ou o vídeo mudou. Gere outra prévia.',409);}
  // YouTube videos.update(part=snippet) REPLACES snippet's mutable fields.
  // Always send full original+patched editable snippet and NEVER include status.
  const update={id,snippet:after};
  const url=new URL(API_BASE);url.searchParams.set('part','snippet');
  const updated=await youtubeJson(url.toString(),auth.accessToken,{
   method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(update)
  });
  return Response.json({schema:'gomotion-youtube-edit-applied-v1',videoId:id,
   videoUrl:'https://www.youtube.com/watch?v='+id,
   before,after:editable(updated as OwnedVideo),applied:true,
   privacyWasNotRequestedToChange:true},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
