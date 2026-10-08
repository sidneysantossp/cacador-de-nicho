export const EXTERNAL_MEDIA_MAX_VIDEO_BYTES=250*1024*1024;
export const EXTERNAL_MEDIA_MAX_IMAGE_BYTES=25*1024*1024;

export const externalMediaMimeKind=(mime:string)=>{
  const normalized=mime.toLowerCase().split(';')[0].trim();
  if(['image/png','image/jpeg','image/webp'].includes(normalized))return 'image' as const;
  if(['video/mp4','video/webm','video/quicktime'].includes(normalized))return 'video' as const;
  return null;
};

export function externalMediaUrlShapeAllowed(value:string){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:')return false;
    if(url.username||url.password)return false;
    if(url.port&&url.port!=='443')return false;
    if(!url.hostname||url.hostname.length>253)return false;
    const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
    if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local'))return false;
    return true;
  }catch{
    return false;
  }
}

export function externalMediaIpIsPublic(value:string){
  const input=value.toLowerCase().replace(/^\[|\]$/g,'');
  if(input.includes(':')){
    if(input==='::'||input==='::1')return false;
    if(input.startsWith('fc')||input.startsWith('fd'))return false;
    if(/^fe[89ab]/.test(input))return false;
    const mapped=input.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped?externalMediaIpIsPublic(mapped[1]):true;
  }
  const parts=input.split('.').map(Number);
  if(parts.length!==4||parts.some(part=>!Number.isInteger(part)||part<0||part>255))return false;
  const [a,b]=parts;
  if(a===0||a===10||a===127)return false;
  if(a===100&&b>=64&&b<=127)return false;
  if(a===169&&b===254)return false;
  if(a===172&&b>=16&&b<=31)return false;
  if(a===192&&b===168)return false;
  if(a===198&&(b===18||b===19))return false;
  if(a>=224)return false;
  return true;
}

export function externalMediaMaxBytes(mime:string){
  const kind=externalMediaMimeKind(mime);
  return kind==='image'
    ?EXTERNAL_MEDIA_MAX_IMAGE_BYTES
    :kind==='video'
      ?EXTERNAL_MEDIA_MAX_VIDEO_BYTES
      :0;
}
