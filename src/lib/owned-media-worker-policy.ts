export function ownedVisualRetryPolicy(input:{
  status:number;
  message:string;
  attempts:number;
}){
  const status=Math.max(0,Math.round(input.status||0));
  const attempts=Math.max(1,Math.round(input.attempts||1));
  const message=String(input.message??'');
  const storagePressure=
    status===507||
    /\benospc\b|no space left on device|insufficient storage|temporary storage/i.test(message);
  const transient=
    storagePressure||
    status===429||status===502||status===503||status===504||
    /http\s+50[234]|high demand|temporar|timeout|excedeu o tempo|unavailable/i.test(message);
  if(!transient||attempts>=5){
    return {retry:false,storagePressure,delaySeconds:0};
  }
  const delaySeconds=storagePressure
    ?900
    :status===429
      ?Math.min(1800,300*Math.pow(2,attempts-1))
      :Math.min(900,60*Math.pow(2,attempts-1));
  return {retry:true,storagePressure,delaySeconds};
}
