import 'server-only';

import { checked, db } from './db';

export const currentProductionAgentId=()=>process.env.CACADORES_AGENT_ID?.trim().toLowerCase()||'atlas';
