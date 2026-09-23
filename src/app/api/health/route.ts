import { db, dbConfigured } from '@/lib/server/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  const configured=dbConfigured();
  let databaseConnected=false;

  if(configured){
    try{
      const result=await db().from('radar_managed_channels').select('id',{count:'exact',head:true});
      databaseConnected=!result.error;
    }catch{
      databaseConnected=false;
    }
  }

  const ok=configured&&databaseConnected;

  return Response.json({
    ok,
    service:'cacadores-de-nichos',
    databaseConfigured:configured,
    databaseConnected,
    commit:process.env.APP_COMMIT_SHA??'unknown',
    environment:process.env.APP_ENVIRONMENT??process.env.NODE_ENV??'unknown',
    checkedAt:new Date().toISOString()
  },{
    status:ok?200:503,
    headers:{'Cache-Control':'no-store'}
  });
}
