import 'server-only';

import type { YouTubeSearchBudgetState, YouTubeSearchPurpose } from '@/lib/types';
import { canSpendYouTubeSearch, emptyYouTubeSearchBudget, pacificDate, spendYouTubeSearch } from '@/lib/youtube-quota';
import { db, put } from './db';
import { HttpError } from './auth';

export class YouTubeSearchBudgetError extends HttpError {
  constructor(public reason:'blocked'|'daily-limit'|'purpose-limit',message:string){
    super(message,429);
    this.name='YouTubeSearchBudgetError';
  }
}

function budgetId(now=new Date()){
  return `youtube-search-budget:${pacificDate(now)}`;
}

export async function loadYouTubeSearchBudget(now=new Date()):Promise<YouTubeSearchBudgetState>{
  const id=budgetId(now);
  const result=await db().from('radar_analyses').select('payload').eq('id',id).maybeSingle();
  if(result.error)throw new HttpError('Falha ao ler o orçamento diário de buscas do YouTube.',502);
  const raw=result.data?.payload as YouTubeSearchBudgetState|undefined;
  if(!raw||raw.kind!=='youtube-search-budget'||raw.pacificDate!==pacificDate(now))return emptyYouTubeSearchBudget(now);
  return {
    ...emptyYouTubeSearchBudget(now),
    ...raw,
    remaining:Math.max(0,(raw.limit??100)-(raw.used??0))
  };
}

export async function claimYouTubeSearch(
  purpose:YouTubeSearchPurpose,
  requestKey:string,
  options:{dedupeWindow?:boolean}={}
){
  const now=new Date();
  const state=await loadYouTubeSearchBudget(now);
  const slot=Math.floor(now.getTime()/(6*3600000));
  const dedupeKey=`${purpose}:${requestKey}:slot-${slot}`;

  if(options.dedupeWindow&&state.recentKeys.includes(dedupeKey)){
    const next={...state,duplicateSkips:state.duplicateSkips+1,updatedAt:now.toISOString()};
    await put('radar_analyses',next.id,next);
    return {allowed:false,duplicate:true,state:next};
  }

  const decision=canSpendYouTubeSearch(state,purpose);
  if(!decision.allowed){
    const reason=decision.reason??'daily-limit';
    const message=reason==='purpose-limit'
      ?`O orçamento de busca reservado para ${purpose} foi esgotado hoje. O sistema preservou quota para outras etapas de maior valor.`
      :reason==='daily-limit'
        ?'O orçamento diário de search.list do YouTube foi esgotado. O sistema continuará trabalhando com dados já coletados.'
        :'O bucket de search.list do YouTube está marcado como indisponível nesta data.';
    throw new YouTubeSearchBudgetError(reason,message);
  }

  const next=spendYouTubeSearch(state,purpose,dedupeKey,now);
  await put('radar_analyses',next.id,next);
  return {allowed:true,duplicate:false,state:next};
}

export async function markYouTubeSearchBlocked(reason:string){
  const now=new Date();
  const state=await loadYouTubeSearchBudget(now);
  const next:{[K in keyof YouTubeSearchBudgetState]:YouTubeSearchBudgetState[K]}={
    ...state,
    blocked:true,
    blockedReason:reason,
    updatedAt:now.toISOString()
  };
  await put('radar_analyses',next.id,next);
  return next;
}
