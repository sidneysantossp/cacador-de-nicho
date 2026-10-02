/** Pure, deterministic pre-pilot feasibility gate. Market evidence always comes first. */
export const PRODUCTION_AUTONOMY_VERSION = 'production-autonomy@1.0.0' as const;
export const PRODUCTION_AUTONOMY_STAGES = [
  'research', 'claims', 'script', 'voice', 'transcript', 'scenes', 'asset-sourcing',
  'rights', 'timeline', 'render', 'quality', 'packaging', 'publish', 'learning',
] as const;
export type ProductionAutonomyStatus = 'approved' | 'rejected' | 'blocked' | 'not-eligible';
export type ProductionAutonomyStage = typeof PRODUCTION_AUTONOMY_STAGES[number];
export type VisualSimulationBeat = {
  id: string;
  durationSeconds: number;
  query: string;
  /** Documentary identity (person, place, date, event, viewpoint); never satisfied by generic footage. */
  requiredIdentity?: string;
  generationAllowed: boolean;
  factuality: 'verified' | 'not-required' | 'unknown' | 'unsupported';
  evidenceRefs: string[];
};
export type VisualSimulationTitle = {
  id: string;
  title: string;
  durationSeconds: number;
  beats: VisualSimulationBeat[];
};
export type VisualSupplyEvidence = {
  id: string;
  /** Stable original/source identity. Copies and multiple search hits share this value. */
  sourceIdentity: string;
  source: 'owned' | 'stock';
  kind: 'image' | 'video';
  ready: boolean;
  availability: 'available' | 'unavailable' | 'unknown';
  /** Required for owned assets, including previously acquired stock in R2. */
  storagePath?: string;
  durationSeconds: number | null;
  segmentStartSeconds?: number;
  segmentEndSeconds?: number;
  rights: 'verified' | 'unknown' | 'restricted';
  license: string | null;
  provenanceRef: string | null;
  /** Exact identities verified from visual/provenance evidence, never inferred from query text. */
  verifiedIdentities?: string[];
  matches: { titleId: string; beatId: string; relevance: number; identityVerified: boolean }[];
  /** Image/source reuse across the simulation. Video ranges still cannot overlap. */
  maxUses?: number;
};
export type ProductionAutonomyPolicy = {
  minimumTitles: number;
  minimumSupplyCoveragePercent: number;
  minimumTitleSupplyCoveragePercent: number;
  maximumGenerationPercent: number;
  maximumCostUsd: number;
  maximumCycleMinutes: number;
  maximumOperatorMinutes: number;
  minimumMatchRelevance: number;
  maximumSourceSharePerTitle: number;
  maximumImageUses: number;
  minimumPilotRepeatabilityPercent: number;
  minimumScore: number;
};
export const DEFAULT_PRODUCTION_AUTONOMY_POLICY: Readonly<ProductionAutonomyPolicy> = Object.freeze({
  minimumTitles: 10,
  minimumSupplyCoveragePercent: 80,
  minimumTitleSupplyCoveragePercent: 70,
  maximumGenerationPercent: 20,
  maximumCostUsd: 20,
  maximumCycleMinutes: 120,
  maximumOperatorMinutes: 5,
  minimumMatchRelevance: 0.7,
  maximumSourceSharePerTitle: 0.2,
  maximumImageUses: 1,
  minimumPilotRepeatabilityPercent: 80,
  minimumScore: 80,
});
export type ProductionAutonomyInput = {
  market: { validated: boolean; status: string; evidenceRefs: string[] };
  titles: VisualSimulationTitle[];
  supply: VisualSupplyEvidence[];
  providers: { id: string; status: 'available' | 'unavailable' | 'unknown'; evidenceRef?: string }[];
  economics: {
    costUsd: number | null;
    cycleMinutes: number | null;
    operatorMinutes: number | null;
    evidenceRefs: string[];
    basis: 'observed' | 'quoted' | 'unknown';
  };
  automation: { stage: ProductionAutonomyStage; status: 'automatic' | 'manual' | 'unavailable' | 'unknown'; evidenceRef?: string }[];
  generation: { available: boolean | null; evidenceRef?: string };
  repeatability: {
    episodes: 15 | 50 | 100;
    distinctTitleCount: number | null;
    supplyCoveragePercent: number | null;
    evidenceRefs: string[];
  }[];
  policy?: Partial<ProductionAutonomyPolicy>;
};
export type ProductionAutonomyReason = {
  code: string;
  severity: 'blocker' | 'rejection' | 'info';
  message: string;
  evidenceRefs: string[];
};
export type VisualSupplyAllocation = {
  titleId: string;
  beatId: string;
  durationSeconds: number;
  source: 'owned' | 'stock' | 'generation' | 'unresolved';
  assetId?: string;
  sourceIdentity?: string;
  sourceStartSeconds?: number;
  sourceEndSeconds?: number;
};
export type ProductionAutonomyAssessment = {
  version: typeof PRODUCTION_AUTONOMY_VERSION;
  status: ProductionAutonomyStatus;
  marketEligible: boolean;
  /** Summary only; unknown dimensions contribute zero and never authorize progression. */
  score: number;
  scores: {
    visualSupplyCoverage: number | null;
    generationIndependence: number | null;
    rights: number | null;
    cost: number | null;
    time: number | null;
    factuality: number | null;
    repeatability: number | null;
    endToEndAutonomy: number | null;
  };
  coverage: {
    totalSeconds: number;
    ownedSeconds: number;
    stockSeconds: number;
    generationSeconds: number;
    unresolvedSeconds: number;
    ownedPercent: number;
    stockPercent: number;
    supplyPercent: number;
    generationPercent: number;
    unresolvedPercent: number;
    distinctSources: number;
    allocations: VisualSupplyAllocation[];
    titles: { titleId: string; totalSeconds: number; supplyPercent: number }[];
  };
  repeatability: {
    episodes: 15 | 50 | 100;
    distinctTitleCount: number | null;
    supplyCoveragePercent: number | null;
    score: number | null;
    status: 'supported' | 'insufficient' | 'unknown';
    evidenceRefs: string[];
  }[];
  economics: ProductionAutonomyInput['economics'];
  reasons: ProductionAutonomyReason[];
  policy: ProductionAutonomyPolicy;
};

const EPSILON = 0.001;
const round = (value: number) => Math.round(value * 100) / 100;
const percentage = (part: number, total: number) => total > 0 ? round(Math.min(100, Math.max(0, part / total * 100))) : 0;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const positive = (value: unknown): value is number => nonnegative(value) && value > 0;
const referenced = (refs: string[]) => refs.some(ref => Boolean(ref.trim()));

/** Expand semantic sequences to the mandatory <=4s cadence without inventing evidence. */
export function expandVisualSimulationBeats(
  sequences: VisualSimulationBeat[],
): VisualSimulationBeat[] {
  return sequences.flatMap(sequence => {
    if (!positive(sequence.durationSeconds)) return [sequence];
    const count = Math.ceil(sequence.durationSeconds / 4);
    const duration = sequence.durationSeconds / count;
    return Array.from({ length: count }, (_, index) => ({
      ...sequence, id: count === 1 ? sequence.id : `${sequence.id}:${index + 1}`, durationSeconds: duration,
      evidenceRefs: [...sequence.evidenceRefs],
    }));
  });
}

/** Find an unused contiguous temporal segment. Overlapping segment rows never multiply supply. */
function freeInterval(start: number, end: number, duration: number, used: [number, number][]): [number, number] | null {
  let cursor = start;
  for (const [usedStart, usedEnd] of [...used].sort((a, b) => a[0] - b[0])) {
    if (usedEnd <= cursor + EPSILON) continue;
    if (usedStart >= cursor + duration - EPSILON) return [cursor, cursor + duration];
    cursor = Math.max(cursor, usedEnd);
    if (cursor + duration > end + EPSILON) return null;
  }
  return cursor + duration <= end + EPSILON ? [cursor, cursor + duration] : null;
}

export function evaluateProductionAutonomy(input: ProductionAutonomyInput): ProductionAutonomyAssessment {
  const policy = { ...DEFAULT_PRODUCTION_AUTONOMY_POLICY, ...input.policy };
  const reasons: ProductionAutonomyReason[] = [];
  const add = (code: string, severity: ProductionAutonomyReason['severity'], message: string, evidenceRefs: string[] = []) => {
    if (!reasons.some(reason => reason.code === code && reason.message === message)) reasons.push({ code, severity, message, evidenceRefs });
  };
  const marketEligible = input.market.validated === true && referenced(input.market.evidenceRefs);
  if (!marketEligible) add('market-not-validated', 'blocker', 'A validação de mercado com evidência é obrigatória antes do Production Autonomy Fit.', input.market.evidenceRefs);
  const validPolicy = Object.values(policy).every(nonnegative)
    && policy.minimumTitles >= 1 && Number.isInteger(policy.minimumTitles)
    && policy.minimumMatchRelevance <= 1 && policy.maximumSourceSharePerTitle > 0 && policy.maximumSourceSharePerTitle <= 1
    && policy.maximumImageUses >= 1 && Number.isInteger(policy.maximumImageUses)
    && [policy.minimumSupplyCoveragePercent, policy.minimumTitleSupplyCoveragePercent, policy.maximumGenerationPercent, policy.minimumPilotRepeatabilityPercent, policy.minimumScore].every(value => value <= 100);
  if (!validPolicy) add('policy-invalid', 'blocker', 'A política contém limites inválidos; corrija a configuração antes de avaliar.');
  const uniqueTitles = new Set(input.titles.map(title => title.title.trim().toLowerCase())).size;
  if (input.titles.length < policy.minimumTitles || uniqueTitles < policy.minimumTitles) add('simulation-insufficient-titles', 'blocker', `Simule pelo menos ${policy.minimumTitles} títulos distintos completos.`);
  let simulationValid = validPolicy && input.titles.length >= policy.minimumTitles && uniqueTitles >= policy.minimumTitles;
  const ids = new Set<string>();
  for (const title of input.titles) {
    const beatIds = new Set(title.beats.map(beat => beat.id));
    const simulatedSeconds = title.beats.reduce((sum, beat) => sum + (positive(beat.durationSeconds) ? beat.durationSeconds : 0), 0);
    if (!title.id.trim() || ids.has(title.id) || !title.title.trim() || !positive(title.durationSeconds) || !title.beats.length || beatIds.size !== title.beats.length || Math.abs(simulatedSeconds - title.durationSeconds) > EPSILON) {
      simulationValid = false;
      add('simulation-incomplete', 'blocker', `O título ${title.id || '(sem id)'} precisa de IDs únicos e beats cobrindo toda a duração declarada.`);
    }
    ids.add(title.id);
    if (title.beats.some(beat => !beat.id.trim() || !beat.query.trim() || !positive(beat.durationSeconds) || beat.durationSeconds > 4 + EPSILON)) {
      simulationValid = false;
      add('visual-cadence-invalid', 'blocker', `O título ${title.id} contém beat inválido ou acima do teto global de 4 segundos.`);
    }
  }

  const allocations: VisualSupplyAllocation[] = [];
  const usedRanges = new Map<string, [number, number][]>();
  const sourceUses = new Map<string, number>();
  const titleSourceSeconds = new Map<string, number>();
  let uncertainSupply = false;
  let exactIdentityMissing = false;
  let unsupportedSeconds = 0;
  let unknownFactSeconds = 0;
  let factualSeconds = 0;
  let ownedSeconds = 0;
  let stockSeconds = 0;
  let generationSeconds = 0;
  let unresolvedSeconds = 0;
  const totalSeconds = input.titles.reduce((sum, title) => sum + (positive(title.durationSeconds) ? title.durationSeconds : 0), 0);

  for (const title of input.titles) {
    let previousSource: string | undefined;
    for (const beat of title.beats) {
      if (!positive(beat.durationSeconds)) continue;
      if (beat.factuality === 'unsupported') unsupportedSeconds += beat.durationSeconds;
      else if (beat.factuality === 'unknown' || !referenced(beat.evidenceRefs)) unknownFactSeconds += beat.durationSeconds;
      else factualSeconds += beat.durationSeconds;
      const candidates = input.supply.flatMap(asset => {
        const match = asset.matches.find(item => item.titleId === title.id && item.beatId === beat.id);
        return match && nonnegative(match.relevance) && match.relevance >= policy.minimumMatchRelevance && match.relevance <= 1 ? [{ asset, match }] : [];
      }).sort((a, b) => (a.asset.source === 'owned' ? 0 : 1) - (b.asset.source === 'owned' ? 0 : 1) || b.match.relevance - a.match.relevance || a.asset.id.localeCompare(b.asset.id));
      let selected: VisualSupplyAllocation | undefined;
      let beatUncertain = false;
      for (const { asset, match } of candidates) {
        if (asset.availability === 'unknown' || asset.rights === 'unknown' || !asset.provenanceRef?.trim() || !asset.license?.trim()) beatUncertain = true;
        if (!asset.id.trim() || !asset.sourceIdentity.trim() || !asset.ready || asset.availability !== 'available'
          || asset.rights !== 'verified' || !asset.license?.trim() || !asset.provenanceRef?.trim()
          || (asset.source === 'owned' && !asset.storagePath?.trim())) continue;
        if (beat.requiredIdentity && (!match.identityVerified || !asset.verifiedIdentities?.includes(beat.requiredIdentity))) continue;
        if (previousSource === asset.sourceIdentity) continue;
        const titleSourceKey = `${title.id}\u0000${asset.sourceIdentity}`;
        const titleShare = (titleSourceSeconds.get(titleSourceKey) ?? 0) + beat.durationSeconds;
        if (title.beats.length >= 5 && titleShare / title.durationSeconds > policy.maximumSourceSharePerTitle + EPSILON) continue;
        const uses = sourceUses.get(asset.sourceIdentity) ?? 0;
        const limit = asset.maxUses ?? (asset.kind === 'image' ? policy.maximumImageUses : Number.POSITIVE_INFINITY);
        if (limit < 1 || uses >= limit) continue;
        selected = { titleId: title.id, beatId: beat.id, durationSeconds: beat.durationSeconds, source: asset.source, assetId: asset.id, sourceIdentity: asset.sourceIdentity };
        if (asset.kind === 'video') {
          const start = asset.segmentStartSeconds ?? 0;
          const end = asset.segmentEndSeconds ?? asset.durationSeconds;
          if (!nonnegative(start) || !positive(end) || !positive(asset.durationSeconds) || end > asset.durationSeconds + EPSILON || start >= end) {
            selected = undefined;
            beatUncertain = true;
            continue;
          }
          const range = freeInterval(start, end, beat.durationSeconds, usedRanges.get(asset.sourceIdentity) ?? []);
          if (!range) { selected = undefined; continue; }
          selected.sourceStartSeconds = range[0];
          selected.sourceEndSeconds = range[1];
          usedRanges.set(asset.sourceIdentity, [...(usedRanges.get(asset.sourceIdentity) ?? []), range]);
        }
        sourceUses.set(asset.sourceIdentity, uses + 1);
        titleSourceSeconds.set(titleSourceKey, titleShare);
        break;
      }
      if (selected) {
        if (selected.source === 'owned') ownedSeconds += beat.durationSeconds;
        else stockSeconds += beat.durationSeconds;
        previousSource = selected.sourceIdentity;
      } else {
        uncertainSupply ||= beatUncertain;
        if (beat.requiredIdentity) exactIdentityMissing = true;
        const canGenerate = !beat.requiredIdentity && beat.generationAllowed && input.generation.available === true && Boolean(input.generation.evidenceRef?.trim());
        const source = canGenerate ? 'generation' : 'unresolved';
        selected = { titleId: title.id, beatId: beat.id, durationSeconds: beat.durationSeconds, source };
        if (canGenerate) generationSeconds += beat.durationSeconds;
        else unresolvedSeconds += beat.durationSeconds;
        previousSource = undefined;
      }
      allocations.push(selected);
    }
  }

  const supplySeconds = ownedSeconds + stockSeconds;
  const supplyPercent = percentage(supplySeconds, totalSeconds);
  const generationPercent = percentage(generationSeconds, totalSeconds);
  const providerUnknown = input.providers.some(provider => provider.status === 'unknown' || (provider.status === 'available' && !provider.evidenceRef?.trim()));
  const incompleteSupplyEvidence = uncertainSupply || providerUnknown;
  if (supplySeconds < totalSeconds - EPSILON && incompleteSupplyEvidence) add('visual-supply-evidence-unknown', 'blocker', 'Há disponibilidade, licença, proveniência ou consulta de provider sem confirmação; ausência de evidência não é cobertura zero comprovada.');
  if (simulationValid && supplyPercent < policy.minimumSupplyCoveragePercent) add('visual-supply-below-policy', incompleteSupplyEvidence ? 'blocker' : 'rejection', `Cobertura visual reutilizável de ${supplyPercent}% abaixo do mínimo de ${policy.minimumSupplyCoveragePercent}%.`);
  if (generationPercent > policy.maximumGenerationPercent) add('generation-dependency-too-high', 'rejection', `Dependência de geração de ${generationPercent}% acima do limite de ${policy.maximumGenerationPercent}%.`);
  if (unresolvedSeconds > EPSILON) add('visual-needs-unresolved', 'blocker', `${round(unresolvedSeconds)} segundos ainda não têm mídia utilizável nem geração autônoma comprovada.`);
  if (exactIdentityMissing) add('exact-identity-unverified', 'blocker', 'Há necessidade documental de identidade exata sem mídia verificada; stock genérico ou geração não podem substituir essa evidência.');
  const titleCoverage = input.titles.map(title => ({
    titleId: title.id,
    totalSeconds: positive(title.durationSeconds) ? title.durationSeconds : 0,
    supplyPercent: percentage(allocations.filter(allocation => allocation.titleId === title.id && (allocation.source === 'owned' || allocation.source === 'stock')).reduce((sum, allocation) => sum + allocation.durationSeconds, 0), title.durationSeconds),
  }));
  if (simulationValid && titleCoverage.some(title => title.supplyPercent < policy.minimumTitleSupplyCoveragePercent)) add('title-coverage-below-policy', incompleteSupplyEvidence ? 'blocker' : 'rejection', `Ao menos um título fica abaixo de ${policy.minimumTitleSupplyCoveragePercent}% de cobertura; a média do portfólio não pode ocultar um episódio inviável.`);
  if (unsupportedSeconds > EPSILON) add('unsupported-facts', 'rejection', 'A simulação depende de afirmações sem sustentação; remova ou verifique antes do piloto.');
  if (unknownFactSeconds > EPSILON) add('factuality-unverified', 'blocker', 'A factualidade exige evidências verificáveis por beat; a própria simulação não confirma fatos.');

  const economicsKnown = input.economics.basis !== 'unknown' && referenced(input.economics.evidenceRefs);
  const costKnown = economicsKnown && nonnegative(input.economics.costUsd);
  const timeKnown = economicsKnown && positive(input.economics.cycleMinutes) && nonnegative(input.economics.operatorMinutes);
  if (!costKnown || !timeKnown) add('economics-unverified', 'blocker', 'Custo, tempo de ciclo e minutos ativos precisam de medição ou cotação documentada; valores ausentes não valem zero.', input.economics.evidenceRefs);
  if (costKnown && input.economics.costUsd! > policy.maximumCostUsd) add('cost-over-budget', 'rejection', `Custo previsto de US$ ${input.economics.costUsd} supera o limite de US$ ${policy.maximumCostUsd}.`, input.economics.evidenceRefs);
  if (timeKnown && input.economics.cycleMinutes! > policy.maximumCycleMinutes) add('cycle-time-over-budget', 'rejection', `Ciclo previsto de ${input.economics.cycleMinutes} min supera o limite de ${policy.maximumCycleMinutes} min.`, input.economics.evidenceRefs);
  if (timeKnown && input.economics.operatorMinutes! > policy.maximumOperatorMinutes) add('operator-time-over-budget', 'rejection', `Intervenção prevista de ${input.economics.operatorMinutes} min supera o limite de ${policy.maximumOperatorMinutes} min.`, input.economics.evidenceRefs);

  let automaticStages = 0;
  let unknownStages = 0;
  for (const stage of PRODUCTION_AUTONOMY_STAGES) {
    const evidence = input.automation.find(item => item.stage === stage);
    if (!evidence || evidence.status === 'unknown' || !evidence.evidenceRef?.trim()) {
      unknownStages++;
      add('automation-stage-unverified', 'blocker', `A etapa ${stage} não possui capacidade autônoma comprovada.`, evidence?.evidenceRef ? [evidence.evidenceRef] : []);
    } else if (evidence.status !== 'automatic') add('automation-stage-not-autonomous', 'rejection', `A etapa ${stage} está ${evidence.status === 'manual' ? 'manual' : 'indisponível'} e impede autonomia ponta a ponta.`, [evidence.evidenceRef]);
    else automaticStages++;
  }
  const repeatability: ProductionAutonomyAssessment['repeatability'] = ([15, 50, 100] as const).map(episodes => {
    const evidence = input.repeatability.find(item => item.episodes === episodes);
    const known = Boolean(evidence && nonnegative(evidence.distinctTitleCount) && Number.isInteger(evidence.distinctTitleCount) && nonnegative(evidence.supplyCoveragePercent) && evidence.supplyCoveragePercent <= 100 && referenced(evidence.evidenceRefs));
    const score = known ? Math.min(percentage(evidence!.distinctTitleCount!, episodes), evidence!.supplyCoveragePercent!) : null;
    const status = score === null ? 'unknown' : score >= policy.minimumPilotRepeatabilityPercent && evidence!.distinctTitleCount! >= episodes ? 'supported' : 'insufficient';
    if (episodes === 15 && status === 'unknown') add('pilot-repeatability-unverified', 'blocker', 'O portfólio inicial de 15 vídeos precisa de títulos distintos e cobertura de supply comprovados.', evidence?.evidenceRefs);
    if (episodes === 15 && status === 'insufficient') add('pilot-repeatability-insufficient', 'rejection', 'A evidência de repetibilidade não sustenta o portfólio inicial de 15 vídeos.', evidence?.evidenceRefs);
    if (episodes !== 15 && status !== 'supported') add(`scale-${episodes}-${status}`, 'info', `Escala de ${episodes} vídeos ${status === 'unknown' ? 'ainda não verificada' : 'insuficientemente sustentada'}; aprovação de piloto não valida essa escala.`, evidence?.evidenceRefs);
    return { episodes, distinctTitleCount: known ? evidence!.distinctTitleCount : null, supplyCoveragePercent: known ? evidence!.supplyCoveragePercent : null, score, status, evidenceRefs: evidence?.evidenceRefs ?? [] };
  });
  const budgetScore = (value: number, maximum: number) => value <= maximum ? 100 : maximum > 0 ? percentage(maximum, value) : 0;
  const scores: ProductionAutonomyAssessment['scores'] = {
    visualSupplyCoverage: simulationValid ? supplyPercent : null,
    generationIndependence: simulationValid ? percentage(supplySeconds, totalSeconds) : null,
    rights: simulationValid && supplySeconds + generationSeconds >= totalSeconds - EPSILON ? 100 : null,
    cost: costKnown ? budgetScore(input.economics.costUsd!, policy.maximumCostUsd) : null,
    time: timeKnown ? Math.min(budgetScore(input.economics.cycleMinutes!, policy.maximumCycleMinutes), budgetScore(input.economics.operatorMinutes!, policy.maximumOperatorMinutes)) : null,
    factuality: simulationValid && unknownFactSeconds <= EPSILON ? percentage(factualSeconds, totalSeconds) : null,
    repeatability: repeatability.find(item => item.episodes === 15)!.score,
    endToEndAutonomy: unknownStages ? null : percentage(automaticStages, PRODUCTION_AUTONOMY_STAGES.length),
  };
  const score = round((scores.visualSupplyCoverage ?? 0) * .25 + (scores.generationIndependence ?? 0) * .1 + (scores.rights ?? 0) * .15 + (scores.cost ?? 0) * .1 + (scores.time ?? 0) * .05 + (scores.factuality ?? 0) * .15 + (scores.repeatability ?? 0) * .1 + (scores.endToEndAutonomy ?? 0) * .1);
  if (score < policy.minimumScore && !reasons.some(reason => reason.severity === 'blocker' || reason.severity === 'rejection')) add('overall-score-below-policy', 'rejection', `Score ${score} abaixo do mínimo de ${policy.minimumScore}.`);
  const status: ProductionAutonomyStatus = !marketEligible ? 'not-eligible' : reasons.some(reason => reason.severity === 'rejection') ? 'rejected' : reasons.some(reason => reason.severity === 'blocker') ? 'blocked' : 'approved';
  return {
    version: PRODUCTION_AUTONOMY_VERSION, status, marketEligible, score, scores,
    coverage: { totalSeconds: round(totalSeconds), ownedSeconds: round(ownedSeconds), stockSeconds: round(stockSeconds), generationSeconds: round(generationSeconds), unresolvedSeconds: round(unresolvedSeconds), ownedPercent: percentage(ownedSeconds, totalSeconds), stockPercent: percentage(stockSeconds, totalSeconds), supplyPercent, generationPercent, unresolvedPercent: percentage(unresolvedSeconds, totalSeconds), distinctSources: sourceUses.size, allocations, titles: titleCoverage },
    repeatability, economics: { ...input.economics, evidenceRefs: [...input.economics.evidenceRefs] }, reasons, policy,
  };
}
