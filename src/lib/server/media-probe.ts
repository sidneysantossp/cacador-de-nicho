import 'server-only';

import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { signedMediaUrl } from './media-storage';

const execFile=promisify(execFileCallback);
const FFPROBE=process.env.FFPROBE_PATH||'ffprobe';

function rate(value:unknown){
  const text=String(value??'').trim();
  if(!text)return null;
  if(text.includes('/')){
    const [a,b]=text.split('/').map(Number);
    const result=b? a/b : 0;
    return Number.isFinite(result)&&result>0?result:null;
  }
  const result=Number(text);
  return Number.isFinite(result)&&result>0?result:null;
}

export type VideoTechnicalMetadata={
  durationSeconds:number|null;
  width:number|null;
  height:number|null;
  fps:number|null;
  codec:string|null;
  bitrate:number|null;
};

export async function probeVideoInput(input:string):Promise<VideoTechnicalMetadata>{
  const {stdout}=await execFile(FFPROBE,[
    '-v','error',
    '-select_streams','v:0',
    '-show_entries','stream=width,height,duration,avg_frame_rate,codec_name,bit_rate:format=duration,bit_rate',
    '-of','json',
    input
  ],{maxBuffer:2*1024*1024,timeout:120000});
  const data=JSON.parse(stdout) as {
    streams?:Array<{width?:number;height?:number;duration?:string;avg_frame_rate?:string;codec_name?:string;bit_rate?:string}>;
    format?:{duration?:string;bit_rate?:string};
  };
  const stream=data.streams?.[0]??{};
  const duration=Number(stream.duration??data.format?.duration??0);
  const width=Number(stream.width??0);
  const height=Number(stream.height??0);
  const bitrate=Number(stream.bit_rate??data.format?.bit_rate??0);
  return {
    durationSeconds:Number.isFinite(duration)&&duration>0?duration:null,
    width:Number.isFinite(width)&&width>0?Math.round(width):null,
    height:Number.isFinite(height)&&height>0?Math.round(height):null,
    fps:rate(stream.avg_frame_rate),
    codec:String(stream.codec_name??'').trim()||null,
    bitrate:Number.isFinite(bitrate)&&bitrate>0?Math.round(bitrate):null
  };
}

export async function probeStoredVideo(storagePath:string){
  const url=await signedMediaUrl(storagePath,900);
  if(!url)throw new Error('signed-media-url-unavailable');
  return probeVideoInput(url);
}
