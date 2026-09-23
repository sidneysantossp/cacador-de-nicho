import type { YouTubeSearchBudgetState, YouTubeSearchPurpose } from './types';

export const YOUTUBE_SEARCH_DAILY_LIMIT=100;
export const YOUTUBE_SEARCH_PURPOSE_LIMITS:Record<YouTubeSearchPurpose,number>={
  'reference-resolution':4,
  'radar-discovery':48,
  'channel-resolution':8,
  'channel-study':16,
  'similar-channels':24
};

export function pacificDate(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Los_Angeles',
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).formatToParts(now);
  const value=(type:string)=>parts.find(part=>part.type===type)?.value??'';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function emptyYouTubeSearchBudget(now=new Date()):YouTubeSearchBudgetState{
  const date=pacificDate(now);
  return {
    kind:'youtube-search-budget',
    id:`youtube-search-budget:${date}`,
    pacificDate:date,
    limit:YOUTUBE_SEARCH_DAILY_LIMIT,
    used:0,
    remaining:YOUTUBE_SEARCH_DAILY_LIMIT,
    byPurpose:{
      'reference-resolution':0,
      'radar-discovery':0,
      'channel-resolution':0,
      'channel-study':0,
      'similar-channels':0
    },
    purposeLimits:{...YOUTUBE_SEARCH_PURPOSE_LIMITS},
    duplicateSkips:0,
    blocked:false,
    recentKeys:[],
    updatedAt:now.toISOString()
  };
}

export function canSpendYouTubeSearch(state:YouTubeSearchBudgetState,purpose:YouTubeSearchPurpose){
  if(state.blocked)return {allowed:false,reason:'blocked' as const};
  if(state.used>=state.limit)return {allowed:false,reason:'daily-limit' as const};
  if((state.byPurpose[purpose]??0)>=(state.purposeLimits[purpose]??0))return {allowed:false,reason:'purpose-limit' as const};
  return {allowed:true,reason:null};
}

export function spendYouTubeSearch(
  state:YouTubeSearchBudgetState,
  purpose:YouTubeSearchPurpose,
  requestKey:string,
  now=new Date()
):YouTubeSearchBudgetState{
  const used=state.used+1;
  return {
    ...state,
    used,
    remaining:Math.max(0,state.limit-used),
    byPurpose:{...state.byPurpose,[purpose]:(state.byPurpose[purpose]??0)+1},
    recentKeys:[requestKey,...state.recentKeys.filter(key=>key!==requestKey)].slice(0,80),
    updatedAt:now.toISOString()
  };
}
