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


export function selectUniverseMissionOpportunities(
  intelligence:UniverseMarketIntelligence|null,
  max=5
){
  if(!intelligence)return [];
  const demandRank={observed:2,partial:1} as const;
  const saturationRank={low:3,medium:2,uncertain:1} as const;

  return intelligence.gaps.flatMap(gap=>{
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
  }).slice(0,Math.max(0,Math.min(max,10)));
}


const GAP_MATCH_STOP_WORDS=new Set([
  'a','an','and','are','as','at','be','became','because','been','being','between','by','can','could','did','do','does','every','first','for','from',
  'had','has','have','how','if','in','into','is','it','its','life','my','nobody','of','on','only','or','our','out','over','still','than','that','the',
  'their','them','they','this','through','to','was','were','what','when','where','which','who','why','with','without','you','your',
  'como','com','da','das','de','do','dos','e','em','entre','era','essa','esse','esta','este','foi','mais','na','nas','no','nos','o','os','ou','para',
  'pela','pelas','pelo','pelos','por','que','se','sem','ser','seu','sua','suas','seus','um','uma','uns','umas',
  'explained','explain','target','space','variable','changed','change','preserved','mechanism','test','tests','channel','channels','video','videos',
  'history','historical','people','person','ordinary','animal','animals','old','then','now'
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
function directGapMatches(competitor:UniverseCompetitor,gapText:string){
  const terms=[...new Set(lexicalTokens(gapText))];
  let best:string[]=[];
  for(const unit of competitorEvidenceUnits(competitor)){
    const unitTokens=new Set(lexicalTokens(unit));
    const matched=terms.filter(term=>unitTokens.has(term));
    if(matched.length>best.length)best=matched;
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

type UniverseGapDescriptor=Pick<UniverseGap,'title'|'targetSpace'|'changedVariable'|'firstTests'>;

function universeGapText(gap:UniverseGapDescriptor){
  return [gap.title,gap.targetSpace].join(' ');
}

export function universeGapEvidenceMatch(
  competitor:UniverseCompetitor,
  gap:UniverseGapDescriptor
){
  const gapText=universeGapText(gap);
  const matchedTerms=directGapMatches(competitor,gapText);
  const familyMatch=semanticGapFamilyMatch(competitor,gapText);
  return {
    matched:matchedTerms.length>=2||familyMatch,
    matchedTerms,
    familyMatch
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
    const detail=match.matchedTerms.length
      ?`termos do target encontrados: ${match.matchedTerms.slice(0,4).join(', ')}`
      :'padrão semântico específico do target encontrado nos títulos/descrição';
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
      let strongestDirectMatchCount=0;
      for(const gap of investigate){
        const match=universeGapEvidenceMatch(competitor,gap);
        if(match.matched){
          matchedGaps++;
          strongestDirectMatchCount=Math.max(strongestDirectMatchCount,match.matchedTerms.length);
        }
      }
      return matchedGaps?[{competitor,matchedGaps,strongestDirectMatchCount}]:[];
    })
    .sort((a,b)=>{
      if(b.matchedGaps!==a.matchedGaps)return b.matchedGaps-a.matchedGaps;
      if(b.strongestDirectMatchCount!==a.strongestDirectMatchCount)return b.strongestDirectMatchCount-a.strongestDirectMatchCount;
      return compareUniverseDnaPriority(a.competitor,b.competitor);
    })
    .slice(0,limit)
    .map(item=>item.competitor);
}


export function selectUniverseCoverageDnaBatch(
  competitors:UniverseCompetitor[],
  maxItems=5
){
  const limit=Math.max(0,Math.min(maxItems,5));
  if(limit===0)return [];

  const buckets=new Map<string,UniverseCompetitor[]>();
  for(const competitor of competitors.filter(item=>!item.dna)){
    const cluster=competitor.sourceCluster||competitor.cluster||'A classificar';
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
