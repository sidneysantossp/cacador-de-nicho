import { GET as runCron } from '../route';

export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';

export async function GET(request:Request){
  return runCron(request);
}
