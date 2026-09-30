import { authenticated, errorResponse, HttpError } from '@/lib/server/auth';
import {
  AI_FACTORY_BOOTSTRAP,
  PRODUCTION_OPERATING_SYSTEM_DOCUMENT,
  productionOperatingSystemRef
} from '@/lib/production-operating-system';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    return Response.json({
      productionSystem:productionOperatingSystemRef(),
      mandatoryRead:[
        'AI_START_HERE.md',
        PRODUCTION_OPERATING_SYSTEM_DOCUMENT,
        'docs/PROJECT_STATE.md'
      ],
      runtimeBootstrap:AI_FACTORY_BOOTSTRAP
    },{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    return errorResponse(error);
  }
}
