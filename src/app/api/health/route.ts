import { dbConfigured } from '@/lib/server/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  return Response.json({
    ok:true,
    service:'cacadores-de-nichos',
    databaseConfigured:dbConfigured(),
    commit:process.env.APP_COMMIT_SHA??'unknown',
    environment:process.env.APP_ENVIRONMENT??process.env.NODE_ENV??'unknown',
    checkedAt:new Date().toISOString()
  },{headers:{'Cache-Control':'no-store'}});
}
