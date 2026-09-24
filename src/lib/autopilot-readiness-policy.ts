import type { AutopilotReadiness, AutopilotReadinessCheck } from './types';

export type AutopilotReadinessInput={
 channelId:string;
 hasBrain:boolean;
 hasProductionDna:boolean;
 providers:{
  openai:boolean;
  elevenlabs:boolean;
  googleai:boolean;
 };
 workers:{
  automation:boolean;
  learningLoop:boolean;
 };
 youtube:{
  oauthConfigured:boolean;
  connected:boolean;
  scopes:string[];
 };
 operations:{
  automaticAcceptanceInLast24Hours:boolean;
  activeEpisodeAutomation:boolean;
  activeLearningLoop:boolean;
 };
};

const REQUIRED_YOUTUBE_SCOPES=[
 'https://www.googleapis.com/auth/youtube.upload',
 'https://www.googleapis.com/auth/youtube.readonly',
 'https://www.googleapis.com/auth/yt-analytics.readonly'
];

function check(
 code:string,
 label:string,
 area:AutopilotReadinessCheck['area'],
 requiredFor:AutopilotReadinessCheck['requiredFor'],
 ok:boolean,
 detailOk:string,
 detailFail:string,
 failure:'blocker'|'warning'='blocker'
):AutopilotReadinessCheck{
 return {
  code,label,area,requiredFor,
  status:ok?'pass':failure,
  detail:ok?detailOk:detailFail
 };
}

export function buildAutopilotReadiness(input:AutopilotReadinessInput):AutopilotReadiness{
 const scopes=new Set(input.youtube.scopes);
 const youtubeScopesReady=REQUIRED_YOUTUBE_SCOPES.every(scope=>scopes.has(scope));

 const checks:AutopilotReadinessCheck[]=[
  check(
   'channel-brain','Channel Brain','editorial','assisted',
   input.hasBrain,
   'Channel Brain persistido e disponível.',
   'Crie e salve o Channel Brain antes de usar Autopilot.'
  ),
  check(
   'production-dna','Production DNA','production','assisted',
   input.hasProductionDna,
   'Production DNA persistido e disponível.',
   'Crie e salve o Production DNA do canal.'
  ),
  check(
   'openai-provider','OpenAI','production','assisted',
   input.providers.openai,
   'OpenAI configurada para estratégia e roteiro.',
   'Configure a OpenAI no cofre de providers.'
  ),
  check(
   'automation-worker','Episode Automation Worker','workers','assisted',
   input.workers.automation,
   'Worker de Episode Automation configurado.',
   'Configure AUTOMATION_WORKER_URL e AUTOMATION_WORKER_SECRET.'
  ),
  check(
   'elevenlabs-provider','ElevenLabs','production','autonomous',
   input.providers.elevenlabs,
   'ElevenLabs configurada para geração automática de voz.',
   'Configure a ElevenLabs para o modo Autonomous.'
  ),
  check(
   'googleai-provider','Google AI','production','autonomous',
   input.providers.googleai,
   'Google AI configurada para geração automática de mídia.',
   'Configure Google AI para visual assets automáticos.'
  ),
  check(
   'youtube-oauth','YouTube OAuth','youtube','closed-loop',
   input.youtube.oauthConfigured,
   'OAuth do YouTube está configurado no servidor.',
   'Configure Client ID, Client Secret, Redirect URI e chave de criptografia.'
  ),
  check(
   'youtube-connection','Canal YouTube','youtube','closed-loop',
   input.youtube.connected,
   'Canal YouTube conectado e válido.',
   'Conecte ou reautorize o canal YouTube.'
  ),
  check(
   'youtube-scopes','YouTube + Analytics scopes','youtube','closed-loop',
   youtubeScopesReady,
   'Upload, leitura e YouTube Analytics autorizados.',
   'Reconecte o canal concedendo youtube.upload, youtube.readonly e yt-analytics.readonly.'
  ),
  check(
   'learning-loop-worker','Closed Loop Worker','workers','closed-loop',
   input.workers.learningLoop,
   'Closed Loop Worker configurado.',
   'Configure LEARNING_LOOP_WORKER_URL e LEARNING_LOOP_WORKER_SECRET.'
  ),
  check(
   'auto-accept-cooldown','Cooldown de autoaceite','operations','autonomous',
   !input.operations.automaticAcceptanceInLast24Hours,
   'Nenhum autoaceite ocorreu nas últimas 24h.',
   'Já houve autoaceite neste canal nas últimas 24h.',
   'warning'
  ),
  check(
   'episode-automation-idle','Episode Automation livre','operations','autonomous',
   !input.operations.activeEpisodeAutomation,
   'Nenhuma Episode Automation ativa neste canal.',
   'Existe uma Episode Automation ativa/waiting/running.',
   'warning'
  ),
  check(
   'learning-loop-idle','Closed Loop livre','operations','closed-loop',
   !input.operations.activeLearningLoop,
   'Nenhum Closed Loop job está processando este canal.',
   'Existe um Closed Loop job agendado/processando.',
   'warning'
  )
 ];

 const blocker=(required:Set<AutopilotReadinessCheck['requiredFor']>)=>
  checks.some(item=>required.has(item.requiredFor)&&item.status==='blocker');

 const assistedReady=!blocker(new Set(['assisted']));
 const productionAutonomousReady=assistedReady&&!blocker(new Set(['autonomous']));
 const closedLoopReady=productionAutonomousReady&&!blocker(new Set(['closed-loop']));
 const operationalWarnings=checks.some(item=>
  item.area==='operations'&&item.status==='warning'
 );

 return {
  channelId:input.channelId,
  assistedReady,
  productionAutonomousReady,
  closedLoopReady,
  autonomousReady:closedLoopReady&&!operationalWarnings,
  checks,
  checkedAt:new Date().toISOString()
 };
}

export const autopilotRequiredYoutubeScopes=REQUIRED_YOUTUBE_SCOPES;
