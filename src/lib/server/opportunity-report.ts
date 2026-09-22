import 'server-only';

import type { ChannelStudy } from '@/lib/types';
import { HttpError } from './auth';
import { generateOpportunityReport } from './ai';
import { list, put } from './db';

function isChannelStudy(value: unknown): value is ChannelStudy {
  return !!value && typeof value === 'object' && (value as { kind?: string }).kind === 'channel-study';
}

export async function runOpportunityReport(channelStudyId: string) {
  const analyses = await list<unknown>('radar_analyses', 200);
  const study = analyses.find((item): item is ChannelStudy => isChannelStudy(item) && item.id === channelStudyId);

  if (!study) {
    throw new HttpError('Análise de canal não encontrada. Execute a Análise de Canal antes de gerar a oportunidade.', 404);
  }

  const report = await generateOpportunityReport(study);
  await put('radar_analyses', report.id, {
    ...report,
    approval: {
      status: 'pending'
    }
  });

  return {
    ...report,
    approval: {
      status: 'pending'
    }
  };
}
