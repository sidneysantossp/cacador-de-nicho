import 'server-only';

import type { Decision } from '@/lib/types';
import { HttpError } from './auth';

export function assertOpportunityApproved(
  opportunityId: string,
  decisions: Decision[]
) {
  const approved = decisions.some(
    (decision) =>
      decision.opportunityId === opportunityId &&
      decision.decision === 'approved'
  );

  if (!approved) {
    throw new HttpError(
      'A oportunidade precisa ser aprovada antes da análise de IA.',
      403
    );
  }
}
