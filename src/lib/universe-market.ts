import type { UniverseCompetitor, UniverseCurveClassification, UniverseGap, UniverseMarketIntelligence } from './types';
import { compareUniverseDnaPriority, selectUniverseDnaBatch, UNIVERSE_STATUS_RANK } from './universe-policy';

export function universeCurveClassification(channelIds:string[]):UniverseCurveClassification{
  const count=new Set(channelIds.filter(Boolean)).size;
  return count>=3?'structural':count>=2?'emerging':'hypothesis';
}

export function universeGapDemandStatus(
  classification:UniverseCurveClassification,
  targetEvidenceChannelIds:string[]
):'observed'|'partial'|'hypothesis'{
  const count=new Set(targetEvidenceChannelIds.filter(Boolean)).size;
  if(classification==='structural'&&count>=2)return 'observed';
  if(count>=1)return 'partial';
  return 'hypothesis';
}

export function universeKey(value:string){
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,72)||'curve';
}

export function selectUniverseCurveEvidence(competitors:UniverseCompetitor[],max=40,perCluster=8){
  const groups=new Map<string,UniverseCompetitor[]>();
  for(const competitor of competitors.filter(item=>!!item.dna)){
    const key=competitor.cluster||'Unclassified';
    groups.set(key,[...(groups.get(key)??[]),competitor]);
  }
  const sortedGroups=[...groups.entries()]
    .map(([cluster,items])=>[cluster,[...items].sort((a,b)=>{
      if(UNIVERSE_STATUS_RANK[b.status]!==UNIVERSE_STATUS_RANK[a.status])return UNIVERSE_STATUS_RANK[b.status]-UNIVERSE_STATUS_RANK[a.status];
      const signalDelta=(b.signalDetails?.length??b.signals.length)-(a.signalDetails?.length??a.signals.length);
      if(signalDelta!==0)return signalDelta;
      return (b.breakoutRatio??0)-(a.breakoutRatio??0);
    }).slice(0,perCluster)] as const)
    .sort((a,b)=>b[1].length-a[1].length);

  const selected:UniverseCompetitor[]=[];
  let index=0;
  while(selected.length<max&&sortedGroups.some(([,items])=>index<items.length)){
    for(const [,items] of sortedGroups){
      if(selected.length>=max)break;
      if(items[index])selected.push(items[index]);
    }
    index++;
  }
  return selected;
}


const OPPORTUNITY_FAMILY_GENERIC_TOKENS=new Set([
  'historical','history','engineering','engineer','engineers','system','systems','failure','failures',
  'explained','every','type','types','most','dangerous','project','projects','modern','old',
  'target','domain','space'
]);

function opportunityFamilyTokens(gap:Pick<UniverseGap,'targetSpace'|'targetKeywords'>){
  return new Set(
    [gap.targetSpace,...(gap.targetKeywords??[])]
      .join(' ')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g,' ')
      .split(' ')
      .map(token=>token.length>4&&token.endsWith('s')&&!token.endsWith('ss')?token.slice(0,-1):token)
      .filter(token=>token.length>=3&&!OPPORTUNITY_FAMILY_GENERIC_TOKENS.has(token))
  );
}

function sameUniverseOpportunityFamily(a:UniverseGap,b:UniverseGap){
  const aEvidence=new Set(a.targetEvidenceChannelIds.filter(Boolean));
  const bEvidence=new Set(b.targetEvidenceChannelIds.filter(Boolean));
  const sharedEvidence=[...aEvidence].filter(id=>bEvidence.has(id)).length;
  if(sharedEvidence<2)return false;
  const aTokens=opportunityFamilyTokens(a);
  const bTokens=opportunityFamilyTokens(b);
  return [...aTokens].some(token=>bTokens.has(token));
}

export function selectUniverseMissionOpportunities(
  intelligence:UniverseMarketIntelligence|null,
  max=5
){
  if(!intelligence)return [];
  const demandRank={observed:2,partial:1} as const;
  const saturationRank={low:3,medium:2,uncertain:1} as const;

  const ranked=intelligence.gaps.flatMap(gap=>{
    const curve=intelligence.curves.find(item=>item.id===gap.curveId);
    if(
      !curve||
      curve.classification!=='structural'||
      gap.demandStatus==='hypothesis'||
      gap.sampleSaturation==='high'
    )return [];

    const readiness:'pilot-ready'|'investigate'=
      gap.demandStatus==='observed'&&['low','medium'].includes(gap.sampleSaturation)
        ?'pilot-ready'
        :'investigate';
    const targetEvidenceCount=new Set(gap.targetEvidenceChannelIds.filter(Boolean)).size;

    return [{
      gapId:gap.id,
      curveId:curve.id,
      title:gap.title,
      curveName:curve.name,
      targetSpace:gap.targetSpace,
      readiness,
      demandStatus:gap.demandStatus,
      sampleSaturation:gap.sampleSaturation,
      independentCreators:curve.independentCreators,
      targetEvidenceCount,
      firstTest:gap.firstTests[0]??'Definir um piloto de baixo custo antes de escalar produção.',
      alternateAngles:[] as Array<{title:string;curveName:string;targetSpace:string;firstTest:string}>,
      reasons:[
        `Curva estrutural sustentada por ${curve.independentCreators} criador(es) independente(s).`,
        `Demanda no target: ${gap.demandStatus} com ${targetEvidenceCount} canal(is) de evidência.`,
        `Saturação na amostra do Universe: ${gap.sampleSaturation}.`,
        gap.rationale
      ],
      risks:gap.risks
    }];
  }).sort((a,b)=>{
    if(a.readiness!==b.readiness)return a.readiness==='pilot-ready'?-1:1;
    const demandDelta=demandRank[b.demandStatus]-demandRank[a.demandStatus];
    if(demandDelta!==0)return demandDelta;
    const saturationDelta=saturationRank[b.sampleSaturation]-saturationRank[a.sampleSaturation];
    if(saturationDelta!==0)return saturationDelta;
    if(b.independentCreators!==a.independentCreators)return b.independentCreators-a.independentCreators;
    if(b.targetEvidenceCount!==a.targetEvidenceCount)return b.targetEvidenceCount-a.targetEvidenceCount;
    return a.title.localeCompare(b.title);
  });

  const families:typeof ranked=[];
  for(const candidate of ranked){
    const candidateGap=intelligence.gaps.find(item=>item.id===candidate.gapId);
    if(!candidateGap)continue;
    const familyIndex=families.findIndex(existing=>{
      const existingGap=intelligence.gaps.find(item=>item.id===existing.gapId);
      return !!existingGap&&sameUniverseOpportunityFamily(existingGap,candidateGap);
    });
    if(familyIndex<0){
      families.push(candidate);
      continue;
    }
    const primary=families[familyIndex];
    const alternateAngles=[...(primary.alternateAngles??[]),{
      title:candidate.title,
      curveName:candidate.curveName,
      targetSpace:candidate.targetSpace,
      firstTest:candidate.firstTest
    }];
    families[familyIndex]={
      ...primary,
      alternateAngles,
      reasons:[
        ...primary.reasons.slice(0,3),
        `Família consolidada: ${1+alternateAngles.length} ângulo(s) editoriais sustentados pelo mesmo domínio/evidência.`,
        ...primary.reasons.slice(3)
      ]
    };
  }

  return families.slice(0,Math.max(0,Math.min(max,10)));
}

const GAP_MATCH_STOP_WORDS=new Set([
  'a','an','and','are','as','at','be','became','because','been','being','between','by','can','could','did','do','does','every','first','for','from',
  'had','has','have','how','if','in','into','is','it','its','life','my','nobody','of','on','only','or','our','out','over','still','than','that','the',
  'their','them','they','this','through','to','was','were','what','when','where','which','who','why','with','without','you','your',
  'como','com','da','das','de','do','dos','e','em','entre','era','essa','esse','esta','este','foi','mais','na','nas','no','nos','o','os','ou','para',
  'pela','pelas','pelo','pelos','por','que','se','sem','ser','seu','sua','suas','seus','um','uma','uns','umas',
  'explained','explain','target','space','variable','changed','change','preserved','mechanism','test','tests','channel','channels','video','videos',
  'history','historical','people','person','ordinary','animal','animals','old','then','now',
  'day','earth','used','use','using','ancient','iconic','greatest','strange','thing','things','world'
]);

const ANIMAL_SPECIFIC_TERMS=[
  'wildlife','dog','dogs','cat','cats','bird','birds','fish','shark','sharks','whale','whales','wolf','wolves','bee','bees','ant','ants',
  'insect','insects','snake','snakes','lion','lions','tiger','tigers','turtle','turtles','octopus','cockroach','cockroaches','spider','spiders',
  'frog','frogs','horse','horses','bear','bears','eagle','eagles','penguin','penguins','anaconda','anacondas','starfish','anglerfish','snailfish'
];
const ANIMAL_LIFE_CUES=['pov','born','birth','life','survival','survive','rank','ranks'];
const PROFESSION_TERMS=[
  'job','jobs','profession','professions','worker','workers','miner','miners','mining','tanner','tanners','blacksmith','blacksmiths',
  'sailor','sailors','farmer','farmers','servant','servants','smith','smiths','craftsman','craftsmen','laborer','laborers','labourer','labourers',
  'merchant','merchants','gladiator','gladiators','soldier','soldiers'
];
const HISTORY_CONTEXT_TERMS=[
  'ancient','medieval','roman','rome','victorian','history','historical','century','egypt','egyptian','viking','vikings','renaissance','pompeii','1905'
];

function lexicalNormalize(value:string){
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
}
function lexicalCanonicalToken(token:string){
  if(token.length>5&&token.endsWith('ies'))return token.slice(0,-3)+'y';
  if(token.length>4&&token.endsWith('s')&&!token.endsWith('ss'))return token.slice(0,-1);
  return token;
}
function lexicalTokens(value:string){
  return lexicalNormalize(value)
    .split(' ')
    .filter(token=>token.length>=3&&!GAP_MATCH_STOP_WORDS.has(token))
    .map(lexicalCanonicalToken);
}
function competitorEvidenceUnits(competitor:UniverseCompetitor){
  return competitor.recentUploads
    .slice(0,30)
    .map(video=>lexicalNormalize(video.title))
    .filter(Boolean);
}
function hasAnyTerm(corpus:string,terms:string[]){
  const tokens=new Set(lexicalNormalize(corpus).split(' ').filter(Boolean));
  return terms.some(term=>tokens.has(term));
}
function containsTokenPhrase(unitTokens:string[],phraseTokens:string[]){
  if(!phraseTokens.length||phraseTokens.length>unitTokens.length)return false;
  for(let start=0;start<=unitTokens.length-phraseTokens.length;start++){
    if(phraseTokens.every((token,index)=>unitTokens[start+index]===token))return true;
  }
  return false;
}

function directGapMatches(competitor:UniverseCompetitor,gap:UniverseGapDescriptor){
  const targetText=universeGapTargetText(gap);
  const targetTerms=[...new Set(lexicalTokens(targetText))];
  const domainAnchorTerms=[...new Set(lexicalTokens(gap.targetSpace))];
  const targetKeywordPhrases=(gap.targetKeywords??[])
    .map(keyword=>({label:keyword,tokens:lexicalTokens(keyword)}))
    .filter(item=>item.tokens.length>0);
  const titleTerms=[...new Set(lexicalTokens(gap.title))];
  const allTerms=[...new Set([...targetTerms,...domainAnchorTerms,...titleTerms])];
  let best={
    matchedTerms:[] as string[],
    targetMatchedTerms:[] as string[],
    domainAnchorMatchedTerms:[] as string[]
  };

  for(const unit of competitorEvidenceUnits(competitor)){
    const rawUnitTokens=lexicalTokens(unit);
    const unitTokens=new Set(rawUnitTokens);
    const targetMatchedTerms=targetKeywordPhrases.length
      ?targetKeywordPhrases
        .filter(keyword=>containsTokenPhrase(rawUnitTokens,keyword.tokens))
        .map(keyword=>keyword.label)
      :targetTerms.filter(term=>unitTokens.has(term));
    const domainAnchorMatchedTerms=domainAnchorTerms.filter(term=>unitTokens.has(term));
    const matchedTerms=allTerms.filter(term=>unitTokens.has(term));
    const directStrength=targetMatchedTerms.length+domainAnchorMatchedTerms.length;
    const bestStrength=best.targetMatchedTerms.length+best.domainAnchorMatchedTerms.length;
    if(
      directStrength>bestStrength||
      (directStrength===bestStrength&&matchedTerms.length>best.matchedTerms.length)
    )best={matchedTerms,targetMatchedTerms,domainAnchorMatchedTerms};
  }
  return best;
}
function semanticGapFamilyMatch(competitor:UniverseCompetitor,gapText:string){
  const query=lexicalNormalize(gapText);
  const units=competitorEvidenceUnits(competitor);
  const animalTarget=/(?:^| )(animal|animals|wildlife)(?: |$)/.test(query);
  if(animalTarget&&units.some(unit=>hasAnyTerm(unit,ANIMAL_SPECIFIC_TERMS)&&hasAnyTerm(unit,ANIMAL_LIFE_CUES)))return true;

  const professionTarget=/(?:^| )(job|jobs|profession|professions|worker|workers|work)(?: |$)/.test(query);
  const historyTarget=hasAnyTerm(query,HISTORY_CONTEXT_TERMS);
  if(professionTarget&&historyTarget&&units.some(unit=>hasAnyTerm(unit,PROFESSION_TERMS)&&hasAnyTerm(unit,HISTORY_CONTEXT_TERMS)))return true;

  return false;
}

type UniverseGapDescriptor=Pick<UniverseGap,'title'|'targetSpace'|'targetKeywords'|'changedVariable'|'firstTests'>;

function universeGapTargetText(gap:UniverseGapDescriptor){
  return gap.targetKeywords?.length?gap.targetKeywords.join(' '):gap.targetSpace;
}

function universeGapText(gap:UniverseGapDescriptor){
  return [gap.title,universeGapTargetText(gap)].join(' ');
}

const GAP_EVIDENCE_WEAK_DOMAIN_ANCHORS=new Set([
  'abandoned','building','coastal','detail','domestic','flood','historic','household','infrastructure',
  'medical','ocean','object','station','urban'
]);

function strongGapDomainAnchors(anchors:string[]){
  return anchors.filter(anchor=>!GAP_EVIDENCE_WEAK_DOMAIN_ANCHORS.has(anchor));
}

export function universeGapEvidenceMatch(
  competitor:UniverseCompetitor,
  gap:UniverseGapDescriptor
){
  const gapText=universeGapText(gap);
  const direct=directGapMatches(competitor,gap);
  const hasExplicitKeywords=!!gap.targetKeywords?.length;
  const familyMatch=hasExplicitKeywords?false:semanticGapFamilyMatch(competitor,gapText);
  const strongDomainAnchors=strongGapDomainAnchors(direct.domainAnchorMatchedTerms);
  const directKeywordMatch=direct.targetMatchedTerms.length>=1&&direct.matchedTerms.length>=2;
  const strongAnchorMatch=strongDomainAnchors.length>=1&&direct.matchedTerms.length>=2;
  const directDomainMatch=directKeywordMatch||strongAnchorMatch;
  return {
    matched:directDomainMatch||familyMatch,
    matchedTerms:direct.matchedTerms,
    targetMatchedTerms:direct.targetMatchedTerms,
    domainAnchorMatchedTerms:direct.domainAnchorMatchedTerms,
    familyMatch
  };
}

const GAP_CANDIDATE_GENERIC_SINGLE_KEYWORDS=new Set([
  'bathroom','kitchen','household','home','house','room'
]);

function specificGapCandidateTargetKeywords(labels:string[]){
  return labels.filter(label=>{
    const tokens=lexicalTokens(label);
    return tokens.length>=2||(tokens.length===1&&!GAP_CANDIDATE_GENERIC_SINGLE_KEYWORDS.has(tokens[0]));
  });
}

export function universeGapDnaCandidateMatch(
  competitor:UniverseCompetitor,
  gap:UniverseGapDescriptor
){
  const strict=universeGapEvidenceMatch(competitor,gap);
  const direct=directGapMatches(competitor,gap);
  const targetSignalCount=direct.targetMatchedTerms.length;
  const specificTargetKeywords=specificGapCandidateTargetKeywords(direct.targetMatchedTerms);
  const domainAnchorCount=direct.domainAnchorMatchedTerms.length;
  const lexicalCount=direct.matchedTerms.length;
  const hasExplicitKeywords=!!gap.targetKeywords?.length;
  const completeSpecificTargetKeyword=specificTargetKeywords.length>0;
  const genericKeywordWithContext=targetSignalCount>0&&lexicalCount>=2;
  const anchoredCombination=
    domainAnchorCount>=2||
    (domainAnchorCount>=1&&lexicalCount>=2);
  const matched=
    strict.matched||
    (hasExplicitKeywords&&(
      completeSpecificTargetKeyword||
      genericKeywordWithContext||
      anchoredCombination
    ));
  const score=
    (strict.matched?100:0)+
    (hasExplicitKeywords?
      specificTargetKeywords.length*30+
      targetSignalCount*8+
      domainAnchorCount*8+
      Math.min(lexicalCount,5)
      :0);
  return {
    matched,
    score,
    strictEvidence:strict.matched,
    matchedTerms:direct.matchedTerms,
    targetMatchedTerms:direct.targetMatchedTerms,
    domainAnchorMatchedTerms:direct.domainAnchorMatchedTerms
  };
}

export function resolveUniverseGapEvidence(
  competitors:UniverseCompetitor[],
  gap:UniverseGapDescriptor,
  suggestedChannelIds:string[]=[]
){
  const validIds=new Set(competitors.map(item=>item.channelId));
  const suggested=new Set(suggestedChannelIds.filter(id=>validIds.has(id)));
  const channelIds:string[]=[];
  const seen=new Set<string>();
  const evidence:string[]=[];

  for(const competitor of competitors){
    const match=universeGapEvidenceMatch(competitor,gap);
    if(!match.matched)continue;
    if(!seen.has(competitor.channelId)){
      seen.add(competitor.channelId);
      channelIds.push(competitor.channelId);
    }
    const detail=match.targetMatchedTerms.length
      ?`domínio target: ${match.targetMatchedTerms.slice(0,4).join(', ')}; apoio no mesmo título: ${match.matchedTerms.slice(0,5).join(', ')}`
      :match.domainAnchorMatchedTerms.length
        ?`âncora do target: ${match.domainAnchorMatchedTerms.slice(0,4).join(', ')}; apoio no mesmo título: ${match.matchedTerms.slice(0,5).join(', ')}`
        :'padrão semântico legado específico do target encontrado no mesmo título';
    const origin=suggested.has(competitor.channelId)?'Sugestão da IA validada':'Corroboração do backend';
    evidence.push(`${origin} em ${competitor.name}: ${detail}.`);
  }

  return {channelIds,evidence:evidence.slice(0,8)};
}

export function selectUniverseGapValidationDnaBatch(
  competitors:UniverseCompetitor[],
  intelligence:UniverseMarketIntelligence|null,
  maxItems=2
){
  const limit=Math.max(0,Math.min(maxItems,5));
  if(!intelligence||limit===0)return [];

  const investigate=selectUniverseMissionOpportunities(intelligence,10)
    .filter(item=>item.readiness==='investigate')
    .map(item=>intelligence.gaps.find(gap=>gap.id===item.gapId))
    .filter((gap):gap is UniverseMarketIntelligence['gaps'][number]=>!!gap);
  if(!investigate.length)return [];

  return competitors
    .filter(competitor=>!competitor.dna)
    .flatMap(competitor=>{
      let matchedGaps=0;
      let strictEvidenceGaps=0;
      let strongestCandidateScore=0;
      for(const gap of investigate){
        const match=universeGapDnaCandidateMatch(competitor,gap);
        if(match.matched){
          matchedGaps++;
          if(match.strictEvidence)strictEvidenceGaps++;
          strongestCandidateScore=Math.max(strongestCandidateScore,match.score);
        }
      }
      return matchedGaps?[{competitor,matchedGaps,strictEvidenceGaps,strongestCandidateScore}]:[];
    })
    .sort((a,b)=>{
      if(b.strictEvidenceGaps!==a.strictEvidenceGaps)return b.strictEvidenceGaps-a.strictEvidenceGaps;
      if(b.matchedGaps!==a.matchedGaps)return b.matchedGaps-a.matchedGaps;
      if(b.strongestCandidateScore!==a.strongestCandidateScore)return b.strongestCandidateScore-a.strongestCandidateScore;
      return compareUniverseDnaPriority(a.competitor,b.competitor);
    })
    .slice(0,limit)
    .map(item=>item.competitor);
}


export function universeCoverageCluster(competitor:UniverseCompetitor){
  return competitor.sourceCluster||competitor.cluster||'A classificar';
}

export function selectUniverseCoverageDnaBatch(
  competitors:UniverseCompetitor[],
  maxItems=5
){
  const limit=Math.max(0,Math.min(maxItems,5));
  if(limit===0)return [];

  const buckets=new Map<string,UniverseCompetitor[]>();
  for(const competitor of competitors.filter(item=>!item.dna)){
    const cluster=universeCoverageCluster(competitor);
    buckets.set(cluster,[...(buckets.get(cluster)??[]),competitor]);
  }
  for(const items of buckets.values())items.sort(compareUniverseDnaPriority);

  const selected:UniverseCompetitor[]=[];
  while(selected.length<limit){
    const ranked=[...buckets.entries()]
      .filter(([,items])=>items.length>0)
      .sort((a,b)=>{
        const backlog=b[1].length-a[1].length;
        if(backlog!==0)return backlog;
        const priority=compareUniverseDnaPriority(a[1][0],b[1][0]);
        if(priority!==0)return priority;
        return a[0].localeCompare(b[0]);
      });
    if(!ranked.length)break;

    let advanced=false;
    for(const [,items] of ranked){
      const competitor=items.shift();
      if(!competitor)continue;
      selected.push(competitor);
      advanced=true;
      if(selected.length>=limit)break;
    }
    if(!advanced)break;
  }
  return selected;
}

export function selectUniverseDnaBootstrapBatch(
  competitors:UniverseCompetitor[],
  intelligence:UniverseMarketIntelligence|null,
  maxItems=5,
  targetedSlots=2
){
  const limit=Math.max(0,Math.min(maxItems,5));
  if(limit===0)return [];

  const targeted=selectUniverseGapValidationDnaBatch(
    competitors,
    intelligence,
    Math.min(Math.max(0,targetedSlots),limit)
  );
  const targetedIds=new Set(targeted.map(item=>item.id));
  const remaining=competitors.filter(item=>!targetedIds.has(item.id));
  const normalLimit=limit-targeted.length;
  const coverageSlots=normalLimit<=1?normalLimit:Math.ceil(normalLimit*2/3);
  const coverage=selectUniverseCoverageDnaBatch(remaining,coverageSlots);
  const coverageIds=new Set(coverage.map(item=>item.id));
  const global=selectUniverseDnaBatch(
    remaining.filter(item=>!coverageIds.has(item.id)),
    normalLimit-coverage.length
  );
  return [...targeted,...coverage,...global];
}
