import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type VideoEditState={
 title:string;description:string;tags:string[];categoryId:string;defaultLanguage?:string;
};
export type VideoEditPatch={title?:string;description?:string;tags?:string[]};
const charSafe=(s:string)=>!/[<>\u0000-\u001F\u007F]/u.test(s);
const descriptionSafe=(s:string)=>!/[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(s);
const utf8=(s:string)=>Buffer.byteLength(s,'utf8');
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function validateYouTubeVideoId(value:unknown):string{
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{11}$/.test(value))throw Error('INVALID_VIDEO_ID');
 return value;
}
export function normalizedVideoState(value:VideoEditState):VideoEditState{
 const state:VideoEditState={
  title:String(value.title??''),description:String(value.description??''),
  tags:Array.isArray(value.tags)?value.tags.map(s=>String(s)):[],
  categoryId:String(value.categoryId??'')
 };
 if(value.defaultLanguage)state.defaultLanguage=String(value.defaultLanguage);
 if(!state.title||!state.categoryId)throw Error('INCOMPLETE_YOUTUBE_SNIPPET');
 return state;
}
export function validateVideoEditPatch(value:unknown):VideoEditPatch{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_EDIT_PATCH');
 const object=value as Record<string,unknown>;
 if(!Object.keys(object).length||Object.keys(object).some(k=>!['title','description','tags'].includes(k)))
  throw Error('UNSUPPORTED_EDIT_FIELDS');
 const p:VideoEditPatch={};
 if('title' in object){
  if(typeof object.title!=='string'||object.title.trim().length<2||[...object.title].length>100||!charSafe(object.title))throw Error('INVALID_TITLE');
  p.title=object.title.trim();
 }
 if('description' in object){
  if(typeof object.description!=='string'||utf8(object.description)>5000||!descriptionSafe(object.description))throw Error('INVALID_DESCRIPTION');
  p.description=object.description;
 }
 if('tags' in object){
  if(!Array.isArray(object.tags)||object.tags.length>60||object.tags.some(x=>typeof x!=='string'||!x.trim()||!charSafe(x)||utf8(x)>100))
   throw Error('INVALID_TAGS');
  const tags=object.tags.map(x=>(x as string).trim());
  if(tags.reduce((count,t)=>count+t.length+(t.includes(' ')?2:0),Math.max(0,tags.length-1))>500)throw Error('TAGS_TOO_LONG');
  p.tags=tags;
 }
 return p;
}
export function editedVideoState(before:VideoEditState,patch:VideoEditPatch):VideoEditState{
 return {...normalizedVideoState(before),...patch};
}
type PreviewPayload={v:1;videoId:string;channelId:string;beforeHash:string;patch:VideoEditPatch;expiresAt:number};
function signature(payload:string,secret:string){
 return createHmac('sha256',secret).update(payload).digest('base64url');
}
export function makeVideoEditPreview(videoId:string,channelId:string,before:VideoEditState,rawPatch:unknown,secret:string,now=Date.now()){
 validateYouTubeVideoId(videoId);
 const patch=validateVideoEditPatch(rawPatch);
 if(secret.length<32||!/^UC[A-Za-z0-9_-]{22}$/.test(channelId))throw Error('BRIDGE_NOT_CONFIGURED');
 const normalized=normalizedVideoState(before),after=editedVideoState(normalized,patch);
 if(digest(normalized)===digest(after))throw Error('NO_CHANGES');
 const payload:PreviewPayload={v:1,videoId,channelId,beforeHash:digest(normalized),patch,expiresAt:now+10*60*1000};
 const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
 return {before:normalized,after,expiresAt:payload.expiresAt,confirmationToken:body+'.'+signature(body,secret)};
}
export function verifyVideoEditPreview(token:string,videoId:string,channelId:string,current:VideoEditState,secret:string,now=Date.now()){
 if(secret.length<32||typeof token!=='string'||token.length>20000)throw Error('INVALID_PREVIEW_TOKEN');
 const [body,mac,...extra]=token.split('.');
 if(!body||!mac||extra.length)throw Error('INVALID_PREVIEW_TOKEN');
 const expected=Buffer.from(signature(body,secret));const got=Buffer.from(mac);
 if(expected.length!==got.length||!timingSafeEqual(expected,got))throw Error('INVALID_PREVIEW_TOKEN');
 let payload:PreviewPayload;
 try{payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8')) as PreviewPayload;}catch{throw Error('INVALID_PREVIEW_TOKEN');}
 if(payload.v!==1||payload.videoId!==videoId||payload.channelId!==channelId||!Number.isFinite(payload.expiresAt)||
  payload.expiresAt<now||payload.expiresAt>now+10*60*1000)throw Error('PREVIEW_EXPIRED_OR_WRONG_VIDEO');
 if(payload.beforeHash!==digest(normalizedVideoState(current)))throw Error('VIDEO_CHANGED_SINCE_PREVIEW');
 return editedVideoState(current,validateVideoEditPatch(payload.patch));
}
