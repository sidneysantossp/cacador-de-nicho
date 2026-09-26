export const LONG_FORM_EDITOR_WINDOW_SECONDS=10*60;

export type LongFormEditorWindow={
  id:string;
  sequence:number;
  label:string;
  startSeconds:number;
  endSeconds:number;
  durationSeconds:number;
};

export function timedContentDuration(
  items:Array<{startSeconds:number;endSeconds?:number|null}>
){
  let duration=0;
  for(const item of items){
    const end=Number(item.endSeconds??item.startSeconds);
    if(Number.isFinite(end))duration=Math.max(duration,end);
  }
  return Math.max(0,duration);
}

export function buildLongFormEditorWindows(
  durationSeconds:number,
  maxWindowSeconds=LONG_FORM_EDITOR_WINDOW_SECONDS
):LongFormEditorWindow[]{
  const duration=Math.max(0,Number(durationSeconds)||0);
  const size=Math.max(60,Number(maxWindowSeconds)||LONG_FORM_EDITOR_WINDOW_SECONDS);
  if(duration<=size){
    return [{
      id:'window-1',sequence:1,label:'Block 01',
      startSeconds:0,endSeconds:duration,durationSeconds:duration
    }];
  }
  const count=Math.ceil(duration/size);
  return Array.from({length:count},(_,index)=>{
    const start=index*size;
    const end=Math.min(duration,start+size);
    return {
      id:'window-'+String(index+1),
      sequence:index+1,
      label:'Block '+String(index+1).padStart(2,'0'),
      startSeconds:start,
      endSeconds:end,
      durationSeconds:Math.max(0,end-start)
    };
  });
}

export function timedEntriesInWindow<T extends {startSeconds:number}>(
  items:T[],
  window:LongFormEditorWindow|null
){
  if(!window)return items.map((item,index)=>({item,index}));
  return items
    .map((item,index)=>({item,index}))
    .filter(({item})=>
      item.startSeconds>=window.startSeconds&&
      (
        item.startSeconds<window.endSeconds||
        (window.durationSeconds===0&&item.startSeconds===window.startSeconds)
      )
    );
}
