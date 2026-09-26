export const LONG_FORM_JSON_LIMITS={
  transcript:4*1024*1024,
  scenePlan:4*1024*1024,
  visualPromptSet:8*1024*1024,
  timeline:8*1024*1024,
  videoEdit:8*1024*1024
} as const;

export type LongFormJsonPayload=keyof typeof LONG_FORM_JSON_LIMITS;

export function longFormJsonLimit(kind:LongFormJsonPayload){
  return LONG_FORM_JSON_LIMITS[kind];
}
