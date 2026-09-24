import type {
  ChannelAutopilotSettings, ManagedChannel
} from './types';

export const defaultChannelAutopilot:ChannelAutopilotSettings={
  enabled:false,
  mode:'assisted',
  startOnAcceptedNextEpisode:true
};

export function effectiveChannelAutopilot(
  channel:Pick<ManagedChannel,'autopilot'>
):ChannelAutopilotSettings{
  return {...defaultChannelAutopilot,...(channel.autopilot??{})};
}

export function channelAutopilotStartsAcceptedEpisode(
  channel:Pick<ManagedChannel,'autopilot'>
){
  const autopilot=effectiveChannelAutopilot(channel);
  return autopilot.enabled&&autopilot.startOnAcceptedNextEpisode;
}

export async function startAcceptedEpisodeAutopilot<T extends {id:string;mode:'assisted'|'autonomous'}>(
  channel:Pick<ManagedChannel,'autopilot'>,
  contentProjectId:string,
  createRun:(input:{contentProjectId:string;mode:'assisted'|'autonomous'})=>Promise<T>
){
  const autopilot=effectiveChannelAutopilot(channel);
  if(!autopilot.enabled||!autopilot.startOnAcceptedNextEpisode){
    return {
      automationRunId:undefined,
      automationMode:undefined,
      automationStarted:false,
      automationError:undefined
    };
  }

  try{
    const run=await createRun({
      contentProjectId,
      mode:autopilot.mode
    });
    return {
      automationRunId:run.id,
      automationMode:run.mode,
      automationStarted:true,
      automationError:undefined
    };
  }catch(error){
    return {
      automationRunId:undefined,
      automationMode:autopilot.mode,
      automationStarted:false,
      automationError:error instanceof Error?error.message:'Falha ao iniciar Episode Automation.'
    };
  }
}
