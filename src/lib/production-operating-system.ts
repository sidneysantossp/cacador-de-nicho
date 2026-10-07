export const PRODUCTION_OPERATING_SYSTEM_ID='factory-mode' as const;
export const PRODUCTION_OPERATING_SYSTEM_VERSION='1.1.0' as const;
export const PRODUCTION_OPERATING_SYSTEM_DOCUMENT='docs/PRODUCTION_OPERATING_SYSTEM.md' as const;

export const AI_FACTORY_BOOTSTRAP=[
  'GLOBAL PRODUCTION OPERATING SYSTEM: factory-mode@1.1.0.',
  'This contract applies to every owned Caçadores de Nichos content project.',
  'Operate batch-first and exception-driven: after the operator approves the project or batch scope, advance through deterministic gates without requesting repetitive approvals.',
  'Do not start new scope on a clock or invent projects. Factory Mode starts from an operator-approved project/opportunity/batch.',
  'Before large-scale production, require evidence, a repeatable mechanism and scalability appropriate to the project.',
  'Canonical episode path: selection -> incremental research -> Claim Ledger -> ORIGINALITY / ANTI-SLOP GATE -> script -> voice -> transcript/timestamps -> Scene Plan -> Asset Vault matching -> licensed/open sources if needed -> original AI assets for unresolved needs -> rights/provenance and synthetic-media review -> edit/timeline -> render -> QA -> packaging -> publish/hold -> learning loop.',
  'Search the owned Asset Vault before generating new media. Prefer owned assets, then reusable owned generated elements, then usable archive/open media, licensed stock, and finally new AI media.',
  'GLOBAL VISUAL CADENCE: target 3-4 seconds per visual beat and block any image, video clip, shot or visually unchanged composition that exceeds 4 seconds. This applies to every channel and every visual media type. Split longer narration spans into additional meaningful visual beats or reframes before the 4-second ceiling.',
  'PRE-RENDER VISUAL QA: container type is not evidence of motion. An MP4 that is visually static, template-like or only decoratively animated counts as static. Review selected assets from sampled frames plus local motion analysis before Timeline approval/render; reject placeholders, weak semantic matches and template filler. Expensive video generation must advance in bounded batches and pass this QA before scaling the same visual decision.',
  'Never trade factual accuracy, originality, rights/provenance or QA for throughput.',
  'Every episode must prove: discovery, defensible thesis, added value, copy resistance, and evidence/source plan. Current ORIGINALITY / ANTI-SLOP acceptance target is 100/100.',
  'Use READY, PROCESSING, BLOCKED, and only genuine human REVIEW states. A blocker must name the exact stage, dependency, evidence and smallest unblock action.',
  'Prefer parallel batch progress over sequential single-video work. Primary KPI is active operator minutes per finished video.',
  'Throughput progression is 5/day -> 7/day -> 12/day when infrastructure and quality gates support it.',
  'Project-specific Channel Brain and Production DNA add constraints beneath this global operating system; they do not silently remove it.',
  'If an explicit operator override conflicts with this contract, record the override rather than silently changing the rule.'
].join(' ');

export type ProductionOperatingSystemRef={
  id:typeof PRODUCTION_OPERATING_SYSTEM_ID;
  version:typeof PRODUCTION_OPERATING_SYSTEM_VERSION;
  document:typeof PRODUCTION_OPERATING_SYSTEM_DOCUMENT;
  required:true;
};

export function productionOperatingSystemRef():ProductionOperatingSystemRef{
  return {
    id:PRODUCTION_OPERATING_SYSTEM_ID,
    version:PRODUCTION_OPERATING_SYSTEM_VERSION,
    document:PRODUCTION_OPERATING_SYSTEM_DOCUMENT,
    required:true
  };
}

export function withFactoryInstructions(instructions:string){
  return AI_FACTORY_BOOTSTRAP+' '+instructions;
}
