import type {
  ProductionQualityCheck, ProductionQualityCheckCode, ProductionQualityReport,
  ProductionQualityTechnical, RenderJob
} from '@/lib/types';

const EPSILON=.05;
const PLACEHOLDER_RE=/(\bTODO\b|\bTBD\b|\bVERIFY\b|\bFIXME\b|lorem ipsum|\?\?\?|\{\{[^}]+\}\}|\[[A-Z _-]{3,}\])/i;

function check(
  code:ProductionQualityCheckCode,
  category:ProductionQualityCheck['category'],
  title:string,
  status:ProductionQualityCheck['status'],
  summary:string,
  evidence:string[]=[],
  metrics:ProductionQualityCheck['metrics']={}
):ProductionQualityCheck{
  return {id:crypto.randomUUID(),code,category,title,status,summary,evidence,metrics};
}

export type ProductionQualityAssetFact = {
  assetId:string;
  sceneId:string;
  exists:boolean;
  ready:boolean;
  storagePathMatches:boolean;
  sceneMatches:boolean;
  promptAligned:boolean|null;
  promptReason?:string;
  sourceType?:string;
  provider?:string|null;
  licenseType?:string|null;
  licenseLabel?:string|null;
  sourceIdentity?:string|null;
};

export type ProductionQualityCharacterFact = {
  characterId:string;
  name:string;
  sceneCount:number;
  referenceReady:boolean;
};

export function structuralQualityChecks(input:{
  job:RenderJob;
  assetFacts?:ProductionQualityAssetFact[];
  characterFacts?:ProductionQualityCharacterFact[];
}):ProductionQualityCheck[]{
  const {job}=input;
  const manifest=job.payload.manifest;
  const checks:ProductionQualityCheck[]=[];

  checks.push(check(
    'render-completed','render','Render concluído',
    job.status==='completed'&&!!job.outputPath?'pass':'blocker',
    job.status==='completed'&&job.outputPath
      ?'O worker concluiu o render e registrou um output.'
      :'O render não está concluído ou não possui output persistido.',
    [`status=${job.status}`,`output=${job.outputPath?'present':'missing'}`]
  ));

  const clips=[...manifest.visualClips].sort((a,b)=>a.startSeconds-b.startSeconds);
  let coverageOk=clips.length>0;
  const gaps:string[]=[];
  if(clips.length){
    if(clips[0].startSeconds>EPSILON){
      coverageOk=false;
      gaps.push(`gap inicial 0→${clips[0].startSeconds.toFixed(3)}s`);
    }
    for(let i=1;i<clips.length;i++){
      const previous=clips[i-1];
      const current=clips[i];
      if(current.startSeconds>previous.endSeconds+EPSILON){
        coverageOk=false;
        gaps.push(`gap ${previous.endSeconds.toFixed(3)}→${current.startSeconds.toFixed(3)}s`);
      }
    }
    const end=clips.at(-1)!.endSeconds;
    if(end<manifest.durationSeconds-EPSILON){
      coverageOk=false;
      gaps.push(`gap final ${end.toFixed(3)}→${manifest.durationSeconds.toFixed(3)}s`);
    }
  }
  checks.push(check(
    'visual-coverage','timeline','Cobertura visual da Timeline',
    coverageOk?'pass':'blocker',
    coverageOk
      ?'Os clips visuais cobrem a duração esperada sem buracos.'
      :'Há cenas ausentes ou buracos na cobertura visual.',
    coverageOk?[`${clips.length} clip(s) cobrindo ${manifest.durationSeconds.toFixed(2)}s`]:gaps,
    {clipCount:clips.length,durationSeconds:manifest.durationSeconds}
  ));

  const cues=manifest.captions.cues??[];
  let captionsOk=true;
  const captionIssues:string[]=[];
  if(manifest.captions.enabled&&!cues.length){
    captionsOk=false;
    captionIssues.push('captions ativas sem cues');
  }
  let previousEnd=0;
  for(const cue of [...cues].sort((a,b)=>a.startSeconds-b.startSeconds)){
    if(cue.endSeconds<=cue.startSeconds){
      captionsOk=false; captionIssues.push(`cue ${cue.id.slice(0,8)} com duração inválida`);
    }
    if(cue.startSeconds<0||cue.endSeconds>manifest.durationSeconds+EPSILON){
      captionsOk=false; captionIssues.push(`cue ${cue.id.slice(0,8)} fora da duração do render`);
    }
    if(cue.startSeconds<previousEnd-EPSILON){
      captionsOk=false; captionIssues.push(`cue ${cue.id.slice(0,8)} sobrepõe o anterior`);
    }
    previousEnd=Math.max(previousEnd,cue.endSeconds);
  }
  checks.push(check(
    'caption-timing','captions','Sincronia estrutural de legendas',
    captionsOk?'pass':'blocker',
    captionsOk
      ?'As legendas respeitam a janela temporal do render e não se sobrepõem.'
      :'Há cues de legenda estruturalmente fora de sincronia.',
    captionsOk?[`${cues.length} cue(s) verificados`]:captionIssues,
    {cueCount:cues.length,enabled:manifest.captions.enabled}
  ));

  const assetFacts=input.assetFacts??[];
  const identityByAsset=new Map(
    assetFacts.map(fact=>[fact.assetId,fact.sourceIdentity||fact.assetId])
  );
  const sourceIdentities=clips.map(item=>identityByAsset.get(item.assetId)??item.assetId);
  const uniqueAssets=new Set(clips.map(item=>item.assetId)).size;
  const uniqueSources=new Set(sourceIdentities).size;
  const duplicateRatio=clips.length?1-(uniqueSources/clips.length):0;
  const extremeDuplication=clips.length>=8&&duplicateRatio>=.875;
  const excessiveDuplication=clips.length>=5&&duplicateRatio>.6;
  checks.push(check(
    'asset-duplication','visual','Repetição de assets',
    extremeDuplication?'blocker':excessiveDuplication?'warning':'pass',
    extremeDuplication
      ?'O render depende quase inteiramente da mesma mídia de origem; aumente a diversidade antes da publicação.'
      :excessiveDuplication
        ?'A maior parte dos clips reutiliza mídias de origem já usadas; revise monotonia visual.'
        :'A repetição de mídias de origem está dentro do limite operacional.',
    [`${uniqueSources} origem(ns) única(s) em ${clips.length} clip(s) · ${uniqueAssets} Scene Asset ID(s)`],
    {
      uniqueAssets,
      uniqueSources,
      clipCount:clips.length,
      duplicateRatio:Number(duplicateRatio.toFixed(4))
    }
  ));

  if(assetFacts.length){
    const bad=assetFacts.filter(f=>!f.exists||!f.ready||!f.storagePathMatches||!f.sceneMatches);
    checks.push(check(
      'asset-provenance','visual','Proveniência dos assets',
      bad.length?'blocker':'pass',
      bad.length
        ?'Um ou mais assets do manifest perderam rastreabilidade ou integridade de metadados.'
        :'Todos os assets do manifest continuam rastreáveis e coerentes com suas cenas.',
      bad.length?bad.map(f=>[
        f.assetId.slice(0,8),
        !f.exists?'missing':null,
        !f.ready?'not-ready':null,
        !f.storagePathMatches?'path-mismatch':null,
        !f.sceneMatches?'scene-mismatch':null
      ].filter(Boolean).join(':')):[`${assetFacts.length} asset(s) verificados`],
      {checked:assetFacts.length,issues:bad.length}
    ));

    const promptUnknown=assetFacts.filter(f=>f.promptAligned===null);
    const promptBad=assetFacts.filter(f=>f.promptAligned===false);
    const unknownRights=assetFacts.filter(f=>!f.licenseType||f.licenseType==='unknown');
    checks.push(check(
      'asset-rights','visual','Direitos e base de uso dos assets',
      unknownRights.length?'blocker':'pass',
      unknownRights.length
        ?'Um ou mais assets não possuem uma base de uso/licença explicitamente registrada.'
        :'Todos os assets usados no manifest possuem base de uso/licença registrada.',
      unknownRights.length
        ?unknownRights.map(f=>[
          f.assetId.slice(0,8),
          f.sourceType??'source-unknown',
          f.provider??'provider-unknown',
          f.licenseLabel??'license-unknown'
        ].join(':'))
        :[...new Set(assetFacts.map(f=>f.licenseType).filter(Boolean) as string[])],
      {checked:assetFacts.length,unknownRights:unknownRights.length}
    ));

    checks.push(check(
      'prompt-asset-alignment','visual','Prompt × asset',
      promptBad.length?'blocker':promptUnknown.length?'manual-review':'pass',
      promptBad.length
        ?'Há assets associados a versão/prompt incompatível com o contexto visual.'
        :promptUnknown.length
          ?'Parte do alinhamento prompt×asset não pôde ser provada só pelos metadados atuais.'
          :'A proveniência dos assets está alinhada aos prompts versionados disponíveis.',
      promptBad.length
        ?promptBad.map(f=>f.promptReason??(`asset ${f.assetId.slice(0,8)} desalinhado`))
        :promptUnknown.length
          ?promptUnknown.map(f=>f.promptReason??(`asset ${f.assetId.slice(0,8)} requer revisão`))
          :[`${assetFacts.length} asset(s) alinhados`],
      {checked:assetFacts.length,mismatches:promptBad.length,unknown:promptUnknown.length}
    ));
  }else{
    checks.push(check(
      'asset-provenance','visual','Proveniência dos assets','manual-review',
      'Não foi possível consultar os metadados atuais dos assets usados no render.',
      ['asset facts unavailable']
    ));
    checks.push(check(
      'asset-rights','visual','Direitos e base de uso dos assets','manual-review',
      'Os direitos/licenças dos assets precisam de revisão porque os fatos de proveniência não estão disponíveis.',
      ['asset rights unavailable']
    ));
    checks.push(check(
      'prompt-asset-alignment','visual','Prompt × asset','manual-review',
      'O alinhamento prompt×asset precisa ser revisado porque não há fatos de proveniência disponíveis.',
      ['prompt provenance unavailable']
    ));
  }

  if(input.characterFacts===undefined){
    checks.push(check(
      'character-continuity','visual','Consistência de personagem','manual-review',
      'O contexto de personagens desta versão não pôde ser reconstruído automaticamente.',
      ['character context unavailable'],
      {recurringCharacters:null,unreadyReferences:null}
    ));
  }else{
    const characters=input.characterFacts;
    const unready=characters.filter(item=>item.sceneCount>=2&&!item.referenceReady);
    const recurring=characters.filter(item=>item.sceneCount>=2);
    checks.push(check(
      'character-continuity','visual','Consistência de personagem',
      unready.length?'blocker':recurring.length?'manual-review':'pass',
      unready.length
        ?'Há personagem recorrente sem referência visual pronta.'
        :recurring.length
          ?'Referências estão prontas, mas continuidade visual entre cenas exige inspeção visual.'
          :'Não há personagem recorrente que exija validação de continuidade.',
      unready.length
        ?unready.map(item=>`${item.name||item.characterId}: referência não pronta`)
        :recurring.length
          ?recurring.map(item=>`${item.name||item.characterId}: ${item.sceneCount} cenas`)
          :['nenhum personagem recorrente'],
      {recurringCharacters:recurring.length,unreadyReferences:unready.length}
    ));
  }

  const text=[
    ...cues.map(cue=>cue.text),
    ...(manifest.overlays??[]).map(item=>item.text)
  ].filter(Boolean);
  const placeholders=text.filter(value=>PLACEHOLDER_RE.test(value));
  checks.push(check(
    'text-placeholders','text','Placeholders e texto incompleto',
    placeholders.length?'blocker':'pass',
    placeholders.length
      ?'Há placeholders ou marcadores editoriais não resolvidos no texto que será exibido.'
      :'Nenhum marcador TODO/TBD/VERIFY ou placeholder conhecido foi encontrado.',
    placeholders.length?placeholders.slice(0,20):[`${text.length} bloco(s) de texto verificados`],
    {textBlocks:text.length,placeholderBlocks:placeholders.length}
  ));

  checks.push(check(
    'spelling-review','text','Ortografia contextual',
    text.length?'manual-review':'pass',
    text.length
      ?'Ortografia e nomes próprios precisam de revisão contextual antes da liberação final.'
      :'Não há texto visível no render para revisão ortográfica.',
    text.length?[`${text.length} bloco(s) visível(is) requer(em) revisão humana`]:['sem texto visível'],
    {textBlocks:text.length}
  ));

  return checks;
}

export function technicalQualityChecks(
  job:RenderJob,
  technical:ProductionQualityTechnical
):ProductionQualityCheck[]{
  const checks:ProductionQualityCheck[]=[];
  const expected=job.payload.outputFormat??job.payload.manifest.format;
  const expectedDuration=job.payload.manifest.durationSeconds;
  const durationTolerance=Math.max(.15,expectedDuration*.005);

  checks.push(check(
    'decode-integrity','render','Integridade de decode',
    technical.decodeOk?'pass':'blocker',
    technical.decodeOk?'O MP4 foi decodificado integralmente sem erro.':'O MP4 apresentou erro durante o decode completo.',
    [`decode=${technical.decodeOk?'ok':'failed'}`]
  ));

  const durationOk=technical.durationSeconds!==null&&Math.abs(technical.durationSeconds-expectedDuration)<=durationTolerance;
  checks.push(check(
    'duration-match','render','Duração final',
    durationOk?'pass':'blocker',
    durationOk?'A duração do arquivo final corresponde ao manifest.':'A duração final diverge do manifest além da tolerância.',
    [
      `esperado=${expectedDuration.toFixed(3)}s`,
      `observado=${technical.durationSeconds===null?'n/a':technical.durationSeconds.toFixed(3)+'s'}`
    ],
    {expectedSeconds:expectedDuration,observedSeconds:technical.durationSeconds,toleranceSeconds:durationTolerance}
  ));

  const resolutionOk=technical.width===expected.width&&technical.height===expected.height;
  checks.push(check(
    'resolution-match','render','Resolução final',
    resolutionOk?'pass':'blocker',
    resolutionOk?'A resolução final corresponde ao preset solicitado.':'A resolução final não corresponde ao preset solicitado.',
    [`esperado=${expected.width}x${expected.height}`,`observado=${technical.width??'n/a'}x${technical.height??'n/a'}`],
    {expectedWidth:expected.width,expectedHeight:expected.height,width:technical.width,height:technical.height}
  ));

  const expectedRatio=expected.width/expected.height;
  const observedRatio=technical.width&&technical.height?technical.width/technical.height:null;
  const ratioOk=observedRatio!==null&&Math.abs(observedRatio-expectedRatio)<.002;
  checks.push(check(
    'aspect-ratio-match','render','Aspect ratio',
    ratioOk?'pass':'blocker',
    ratioOk?'O aspect ratio final corresponde ao preset.':'O aspect ratio final diverge do preset.',
    [`esperado=${expectedRatio.toFixed(4)}`,`observado=${observedRatio===null?'n/a':observedRatio.toFixed(4)}`],
    {expectedRatio:Number(expectedRatio.toFixed(6)),observedRatio:observedRatio===null?null:Number(observedRatio.toFixed(6))}
  ));

  const fpsOk=technical.fps!==null&&Math.abs(technical.fps-expected.fps)<.02;
  checks.push(check(
    'fps-match','render','Frame rate',
    fpsOk?'pass':'blocker',
    fpsOk?'O frame rate final corresponde ao preset.':'O frame rate final diverge do preset.',
    [`esperado=${expected.fps} fps`,`observado=${technical.fps??'n/a'} fps`],
    {expectedFps:expected.fps,observedFps:technical.fps}
  ));

  checks.push(check(
    'audio-stream','audio','Stream de áudio',
    technical.audioCodec?'pass':'blocker',
    technical.audioCodec?'O arquivo final contém áudio decodificável.':'O arquivo final não contém stream de áudio.',
    [technical.audioCodec?`codec=${technical.audioCodec}`:'audio stream missing'],
    {codec:technical.audioCodec,sampleRate:technical.sampleRate,channels:technical.audioChannels}
  ));

  if(technical.audioCodec){
    const silence=technical.silenceRatio;
    const silenceStatus=silence===null?'manual-review':silence>.8?'blocker':silence>.5?'warning':'pass';
    checks.push(check(
      'audio-silence','audio','Silêncio excessivo',
      silenceStatus,
      silence===null
        ?'Não foi possível medir silêncio com confiança.'
        :silence>.8
          ?'Mais de 80% do áudio está em silêncio.'
          :silence>.5
            ?'Mais da metade do áudio está em silêncio; revise a mixagem.'
            :'A proporção de silêncio está dentro do limite operacional.',
      [`silenceRatio=${silence===null?'n/a':(silence*100).toFixed(2)+'%'}`],
      {silenceSeconds:technical.silenceSeconds,silenceRatio:silence}
    ));

    const clipping=technical.maxVolumeDb!==null&&technical.maxVolumeDb>=-.1;
    checks.push(check(
      'audio-clipping','audio','Pico de áudio',
      technical.maxVolumeDb===null?'manual-review':clipping?'warning':'pass',
      technical.maxVolumeDb===null
        ?'O pico de volume não pôde ser medido.'
        :clipping
          ?'O pico está muito próximo de 0 dB; há risco de clipping.'
          :'O pico de áudio mantém margem abaixo de 0 dB.',
      [`maxVolume=${technical.maxVolumeDb===null?'n/a':technical.maxVolumeDb.toFixed(2)+' dB'}`],
      {maxVolumeDb:technical.maxVolumeDb}
    ));
  }else{
    checks.push(check('audio-silence','audio','Silêncio excessivo','blocker','Sem stream de áudio não há como validar silêncio.',['audio stream missing']));
    checks.push(check('audio-clipping','audio','Pico de áudio','blocker','Sem stream de áudio não há como validar clipping.',['audio stream missing']));
  }

  const black=technical.blackRatio;
  const blackStatus=black===null?'manual-review':black>.2?'blocker':black>.05?'warning':'pass';
  checks.push(check(
    'black-frames','visual','Black frames',
    blackStatus,
    black===null
      ?'Não foi possível medir frames pretos.'
      :black>.2
        ?'Mais de 20% do vídeo foi detectado como frame preto.'
        :black>.05
          ?'Há uma quantidade relevante de frames pretos; revise se é intencional.'
          :'Frames pretos estão dentro do limite operacional.',
    [`blackRatio=${black===null?'n/a':(black*100).toFixed(2)+'%'}`],
    {blackSeconds:technical.blackSeconds,blackRatio:black}
  ));

  return checks;
}

export function qualitySummary(checks:ProductionQualityCheck[]){
  return {
    pass:checks.filter(item=>item.status==='pass').length,
    warnings:checks.filter(item=>item.status==='warning').length,
    blockers:checks.filter(item=>item.status==='blocker').length,
    manualReview:checks.filter(item=>item.status==='manual-review').length
  };
}

export function qualityInitialStatus(checks:ProductionQualityCheck[]):ProductionQualityReport['status']{
  return checks.some(item=>item.status==='blocker')?'blocked':'review';
}

export function qualityApprovalIssues(
  report:ProductionQualityReport,
  overrides:ProductionQualityCheckCode[]
){
  const issues:string[]=[];
  const blockers=report.checks.filter(item=>item.status==='blocker');
  if(blockers.length)issues.push('quality-blockers-present');
  const overrideSet=new Set(overrides);
  const missingManual=report.checks
    .filter(item=>item.status==='manual-review')
    .filter(item=>!overrideSet.has(item.code));
  if(missingManual.length)issues.push('manual-review-not-confirmed');
  return [...new Set(issues)];
}
