import type { Channel, GapOpportunity } from './types';

export type ReferenceTier='Legendary'|'Really Good'|'Reference';
export type ReferenceChannel={
  name:string;
  format:string;
  niche:string;
  tier:ReferenceTier;
  market?:'en'|'adjacent';
};

// Curated from the operator-provided "nichos-nivel-3" reference catalog.
// The catalog is evidence of useful reference patterns, not proof that every
// format x niche combination is an open market.
export const REFERENCE_CHANNELS:ReferenceChannel[]=[
  {name:'Geo History',format:'2D Animation',niche:'History',tier:'Legendary'},
  {name:'NYKentertain',format:'Shorts 3D',niche:'Education',tier:'Legendary'},
  {name:'EVOLUX',format:'3D Animation',niche:'Military',tier:'Legendary'},
  {name:'Baydar (Films)',format:'Shorts 2D',niche:'Sport',tier:'Really Good'},
  {name:'Uncovering',format:'2D Animation',niche:'Politics',tier:'Legendary'},
  {name:'WolfG.Animation',format:'Shorts 2D',niche:'Storytelling',tier:'Legendary'},
  {name:'English Universe Labz',format:'Shorts 2D',niche:'Entertainment',tier:'Legendary'},
  {name:'Sabin Civil Engineering',format:'3D Animation',niche:'Engineering',tier:'Legendary'},
  {name:'Creative Learning',format:'Shorts 3D',niche:'Education',tier:'Legendary'},
  {name:'Real Engineering',format:'3D Animation',niche:'Engineering',tier:'Legendary'},
  {name:'Yarnhub',format:'3D Animation',niche:'Military',tier:'Legendary'},
  {name:'Plan3',format:'2D Animation',niche:'Horror',tier:'Legendary'},
  {name:'cooper galanis',format:'2D Animation',niche:'Crime & Psychology',tier:'Really Good'},
  {name:'Cipher Pol',format:'3D Animation',niche:'Crime',tier:'Really Good'},
  {name:'Mitsi Studio',format:'3D Animation',niche:'Military',tier:'Legendary'},
  {name:'trainer vinny',format:'2D Animation',niche:'Fitness & Health',tier:'Legendary'},
  {name:'Infamous Swoosh',format:'2D Animation',niche:'Entertainment',tier:'Legendary'},
  {name:'Historically',format:'2D Animation',niche:'History',tier:'Legendary'},
  {name:'Not an Expert',format:'Shorts 3D',niche:'Explained',tier:'Really Good'},
  {name:'Trust Me Bro',format:'2D Animation',niche:'Entertainment',tier:'Really Good'},
  {name:'Wholesome Wendy',format:'Shorts 3D',niche:'Storytelling',tier:'Legendary'},
  {name:'Explorist',format:'3D Animation',niche:'Crime & Psychology',tier:'Really Good'},
  {name:'OBLIVION',format:'Shorts 3D',niche:'Military',tier:'Really Good'},
  {name:'Zeck Films',format:'Shorts 3D',niche:'Entertainment',tier:'Legendary'},
  {name:'Global Data',format:'3D Animation',niche:'Stats',tier:'Really Good'},
  {name:'Karadio',format:'Shorts 3D',niche:'Entertainment',tier:'Legendary'},
  {name:'Pure Logic',format:'Shorts 3D',niche:'History',tier:'Legendary'},
  {name:'Serious History',format:'2D Animation',niche:'History',tier:'Really Good'},
  {name:'CircleToonsHD',format:'2D Animation',niche:'Games',tier:'Legendary'},
  {name:'aqurate.',format:'3D Animation',niche:'Engineering',tier:'Really Good'},
  {name:'Cheesy Adventures Co.',format:'Shorts 3D',niche:'Entertainment',tier:'Legendary'},
  {name:'The Efficient Engineer',format:'3D Animation',niche:'Engineering',tier:'Really Good'},
  {name:'Kawaken 3DCG',format:'Shorts 3D',niche:'Engineering',tier:'Legendary'},
  {name:'TheAMaazing',format:'2D Animation',niche:'Storytelling',tier:'Legendary'},
  {name:'Simple History',format:'2D Animation',niche:'History',tier:'Really Good'},
  {name:'Primal Space',format:'3D Animation',niche:'Education',tier:'Legendary'},
  {name:'CITY 3D TIMELAPSE',format:'3D Animation',niche:'History',tier:'Legendary'},
  {name:'SQFT Fish',format:'Shorts 2D',niche:'Animals',tier:'Legendary'},
  {name:'Fact Craze',format:'Shorts 3D',niche:'Education',tier:'Really Good'},
  {name:'Kurzgesagt - In a Nutshell',format:'2D Animation',niche:'Education',tier:'Legendary'},
  {name:'Angelo Motion',format:'Shorts 3D',niche:'Education',tier:'Legendary'},
  {name:'MotionAthlete',format:'3D Animation',niche:'Sport',tier:'Really Good'},
  {name:'How You Thrive',format:'Shorts 3D',niche:'Fitness & Health',tier:'Legendary'},
  {name:'BOU Stories TV',format:'2D Animation',niche:'Education',tier:'Really Good'},
  {name:'nknows',format:'Shorts 3D',niche:'Engineering',tier:'Legendary'},
  {name:'Curio Flix',format:'2D Animation',niche:'Biology',tier:'Legendary'},
  {name:'Dinzo',format:'2D Animation',niche:'Animals',tier:'Legendary'},
  {name:'El Agente Infiltrado',format:'2D Animation',niche:'Crime',tier:'Really Good',market:'adjacent'},
  {name:'Mega Builds',format:'3D Animation',niche:'Engineering',tier:'Reference'},
  {name:'RED SIDE',format:'3D Animation',niche:'Stats',tier:'Really Good'},
  {name:'Health Manager',format:'Shorts 2D',niche:'Fitness & Health',tier:'Legendary'},
  {name:'Zupaya',format:'Shorts 3D',niche:'Gaming',tier:'Legendary'},
  {name:'History with Dave',format:'2D Animation',niche:'History',tier:'Legendary'},
  {name:'SideQuest - Animated History',format:'2D Animation',niche:'History',tier:'Really Good'},
  {name:'Benjamin Busby',format:'2D Animation',niche:'Entertainment',tier:'Legendary'},
  {name:'THE LOVES',format:'3D Animation',niche:'Engineering',tier:'Really Good'},
  {name:'A Talking Hat',format:'2D Animation',niche:'Crime',tier:'Really Good'},
  {name:'The Infographics Show',format:'2D Animation',niche:'Education',tier:'Legendary'},
  {name:'Zam Bam',format:'Shorts 3D',niche:'Gaming',tier:'Legendary'},
  {name:'Tricked Entertain',format:'Shorts 3D',niche:'Entertainment',tier:'Legendary'},
  {name:'If You Wonder Español',format:'3D Animation',niche:'Explained',tier:'Really Good',market:'adjacent'},
  {name:'Shortary',format:'3D Animation',niche:'Crime',tier:'Really Good'},
  {name:'La Hipercélula',format:'2D Animation',niche:'Military',tier:'Legendary',market:'adjacent'},
  {name:'Bugs',format:'2D Animation',niche:'Storytelling',tier:'Legendary'},
  {name:'Historic Dave',format:'2D Animation',niche:'History',tier:'Really Good'},
  {name:'Bro Pump',format:'2D Animation',niche:'Fitness & Health',tier:'Legendary'},
  {name:'Animagraffs',format:'3D Animation',niche:'Engineering',tier:'Legendary'},
  {name:'Fun History',format:'2D Animation',niche:'History',tier:'Legendary'},
  {name:'War Zone',format:'Shorts 3D',niche:'Military',tier:'Legendary'},
  {name:'Relegated Animator',format:'Shorts 2D',niche:'Storytelling',tier:'Legendary'},
  {name:'Shade Scrolls',format:'Shorts 3D',niche:'History',tier:'Legendary'},
  {name:'Just a Rock in Space',format:'2D Animation',niche:'Education',tier:'Really Good'},
  {name:'AiTelly',format:'3D Animation',niche:'Military',tier:'Really Good'},
  {name:'StoryBox Animated',format:'2D Animation',niche:'Storytelling',tier:'Really Good'},
  {name:'IMPERIAL',format:'2D Animation',niche:'Military',tier:'Really Good'},
  {name:'DevRamo',format:'Shorts 3D',niche:'Education',tier:'Legendary'},
  {name:'Finn Tran',format:'2D Animation',niche:'Entertainment',tier:'Really Good'},
  {name:'Toree',format:'2D Animation',niche:'Entertainment',tier:'Legendary'},
  {name:'ECHOZERO',format:'3D Animation',niche:'Military',tier:'Really Good'},
  {name:'Dumb Doggo',format:'2D Animation',niche:'Entertainment',tier:'Legendary'},
  {name:'Roblox Noob',format:'Shorts 3D',niche:'Gaming',tier:'Legendary'},
  {name:'WhirlTales',format:'Shorts 3D',niche:'Storytelling',tier:'Legendary'},
  {name:'Rennrat',format:'Shorts 2D',niche:'Storytelling',tier:'Legendary'},
  {name:'Outer Side',format:'Shorts 2D',niche:'Explained',tier:'Legendary'},
  {name:'Deconstructed',format:'3D Animation',niche:'Engineering',tier:'Really Good'},
  {name:'SolarBalls',format:'2D Animation',niche:'Storytelling',tier:'Legendary'},
  {name:'Casual Navigation',format:'2D Animation',niche:'Engineering',tier:'Really Good'},
  {name:'Lost in Time',format:'3D Animation',niche:'Education',tier:'Legendary'},
  {name:'Arik Yusupow',format:'Shorts 3D',niche:'Entertainment',tier:'Legendary'},
  {name:'Piemations',format:'2D Animation',niche:'Entertainment',tier:'Legendary'},
  {name:'Pivot Master',format:'2D Animation',niche:'Entertainment',tier:'Really Good'},
  {name:'Insight Fusion',format:'Shorts 3D',niche:'Storytelling',tier:'Really Good'},
  {name:'CasiCreative',format:'2D Animation',niche:'Fitness & Health',tier:'Legendary'},
  {name:'illymation',format:'2D Animation',niche:'Storytelling',tier:'Legendary'},
  {name:'Sach Side',format:'Shorts 2D',niche:'Education',tier:'Legendary'},
  {name:'Brewster After-Hours',format:'2D Animation',niche:'Storytelling',tier:'Really Good'},
  {name:'vfunkerv',format:'Shorts 2D',niche:'Entertainment',tier:'Really Good'},
  {name:'InproViz 4D',format:'Shorts 3D',niche:'Entertainment',tier:'Really Good'}
];

export const REFERENCE_DISCOVERY_QUERIES=[
  'animated history|animated military|animated crime',
  '3d animation engineering|3d animation science|3d simulation',
  'animated education|explained animation|faceless explained',
  'animated storytelling|animated entertainment|character storytelling',
  'animated health|animated fitness|animated psychology',
  '3d shorts|animated shorts|faceless shorts'
];

const norm=(value:string)=>value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();

export function referenceForName(name:string){
  const n=norm(name);
  return REFERENCE_CHANNELS.find(r=>norm(r.name)===n);
}

export function buildOpportunityGaps(channels:Channel[]):GapOpportunity[]{
  const formats=[...new Set(REFERENCE_CHANNELS.map(r=>r.format))];
  const niches=[...new Set(REFERENCE_CHANNELS.map(r=>r.niche))];
  const formatCount=new Map(formats.map(f=>[f,REFERENCE_CHANNELS.filter(r=>r.format===f).length]));
  const nicheCount=new Map(niches.map(n=>[n,REFERENCE_CHANNELS.filter(r=>r.niche===n).length]));
  const results:GapOpportunity[]=[];

  for(const format of formats){
    for(const niche of niches){
      const f=formatCount.get(format)??0;
      const n=nicheCount.get(niche)??0;
      if(f<3||n<2)continue;
      const direct=REFERENCE_CHANNELS.filter(r=>r.format===format&&r.niche===niche);
      if(direct.length>1)continue;
      const observed=channels.filter(c=>c.format===format&&c.niche===niche&&c.discoverySource==='reference-adjacent');
      const sameFormat=REFERENCE_CHANNELS.filter(r=>r.format===format&&r.niche!==niche).slice(0,3).map(r=>r.name);
      const sameNiche=REFERENCE_CHANNELS.filter(r=>r.niche===niche&&r.format!==format).slice(0,3).map(r=>r.name);
      const score=(f*n)/(direct.length+1)/(observed.length+1);
      results.push({
        id:`gap-${norm(format).replace(/ /g,'-')}-${norm(niche).replace(/ /g,'-')}`,
        format,
        niche,
        status:'investigate',
        strength:Math.round(score*10)/10,
        directReferences:direct.map(r=>r.name),
        analogReferences:[...sameFormat,...sameNiche].slice(0,6),
        observedChannels:observed.slice(0,5).map(c=>c.name),
        rationale:direct.length===0
          ?`O catálogo contém ${f} referências em ${format} e ${n} em ${niche}, mas nenhuma combinação direta entre os dois. Isso é uma lacuna editorial para investigar, não prova de demanda por si só.`
          :`O catálogo contém apenas uma referência direta em ${format} + ${niche}, apesar de ambos os padrões aparecerem repetidamente em outras combinações. Vale investigar se há espaço para uma segunda perspectiva realmente distinta.`
      });
    }
  }

  return results.sort((a,b)=>b.strength-a.strength).slice(0,12);
}
