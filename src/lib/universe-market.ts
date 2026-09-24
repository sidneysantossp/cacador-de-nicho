import type { UniverseCompetitor, UniverseCurveClassification, UniverseMarketIntelligence } from './types';
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
  'a','an','and','as','at','be','being','by','for','from','how','in','into','is','it','of','on','or','the','their','through','to','what','why','with',
  'every','first','explained','explain','target','space','variable','changed','change','preserved','mechanism','test','tests'
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
function lexicalTokens(value:string){
  return lexicalNormalize(value).split(' ').filter(token=>token.length>=3&&!GAP_MATCH_STOP_WORDS.has(token));
}
function competitorLexicalCorpus(competitor:UniverseCompetitor){
  return lexicalNormalize([
    competitor.name,
    competitor.description,
    ...competitor.recentUploads.slice(0,30).map(video=>video.title)
  ].join(' '));
}
function hasAnyTerm(corpus:string,terms:string[]){
  return terms.some(term=>new RegExp(`(?:^| )${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?: |$)`).test(corpus));
}
function directGapMatches(competitor:UniverseCompetitor,gapText:string){
  const corpus=competitorLexicalCorpus(competitor);
  const terms=[...new Set(lexicalTokens(gapText))];
  return terms.filter(term=>new RegExp(`(?:^| )${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?: |$)`).test(corpus));
}
function semanticGapFamilyMatch(competitor:UniverseCompetitor,gapText:string){
  const query=lexicalNormalize(gapText);
  const corpus=competitorLexicalCorpus(competitor);
  const animalTarget=/(?:^| )(animal|animals|wildlife)(?: |$)/.test(query);
  if(animalTarget&&hasAnyTerm(corpus,ANIMAL_SPECIFIC_TERMS)&&hasAnyTerm(corpus,ANIMAL_LIFE_CUES))return true;

  const professionTarget=/(?:^| )(job|jobs|profession|professions|worker|workers|work)(?: |$)/.test(query);
  const historyTarget=hasAnyTerm(query,HISTORY_CONTEXT_TERMS);
  if(professionTarget&&historyTarget&&hasAnyTerm(corpus,PROFESSION_TERMS)&&hasAnyTerm(corpus,HISTORY_CONTEXT_TERMS))return true;

  return false;
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
        const gapText=[
          gap.title,
          gap.targetSpace,
          gap.changedVariable,
          ...gap.firstTests
        ].join(' ');
        const direct=directGapMatches(competitor,gapText);
        const semantic=semanticGapFamilyMatch(competitor,gapText);
        if(direct.length>=2||semantic){
          matchedGaps++;
          strongestDirectMatchCount=Math.max(strongestDirectMatchCount,direct.length);
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
  const normal=selectUniverseDnaBatch(
    competitors.filter(item=>!targetedIds.has(item.id)),
    limit-targeted.length
  );
  return [...targeted,...normal];
}
