import 'server-only';

import { list, put } from './db';
import { HttpError } from './auth';

type ExecutionType = 'youtube_research' | 'manual_scan' | 'scheduled_scan' | 'ai_analysis';

type ExecutionRun = {
  id: string;
  type: ExecutionType;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  heartbeatAt: string;
  finishedAt?: string;
  message: string;
};

const STALE_MS = 15 * 60 * 1000;

export async function acquireExecution(type: ExecutionType) {
  const runs = await list<ExecutionRun>('radar_runs', 50);
  const now = Date.now();

  const active = runs.find((run) => {
    if (run.status !== 'running' || run.type !== type) return false;
    return now - new Date(run.heartbeatAt ?? run.startedAt).getTime() < STALE_MS;
  });

  if (active) {
    throw new HttpError('Já existe uma execução deste tipo em andamento.', 409);
  }

  const run: ExecutionRun = {
    id: crypto.randomUUID(),
    type,
    status: 'running',
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    message: `Execução ${type} iniciada.`
  };

  await put('radar_runs', run.id, run);
  return run;
}

export async function heartbeatExecution(run: ExecutionRun) {
  await put('radar_runs', run.id, {
    ...run,
    heartbeatAt: new Date().toISOString()
  });
}

export async function finishExecution(run: ExecutionRun, status: 'completed' | 'failed') {
  await put('radar_runs', run.id, {
    ...run,
    status,
    finishedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString()
  });
}
