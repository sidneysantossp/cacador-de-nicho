export type PriorityContentModel={
  id:string;
  name:string;
  fitScore:9|10;
  tier:'core'|'expansion';
  status:'approved';
  thesis:string;
  whyItFits:string[];
  assetAdvantages:string[];
  searchSeeds:string[];
  matchTerms:string[];
  exampleAngles:string[];
};

export const PRIORITY_CONTENT_MODELS:PriorityContentModel[]=[
  {
    id:'city-history-evolution',
    name:'História e evolução das cidades',
    fitScore:10,
    tier:'core',
    status:'approved',
    thesis:'Transformações urbanas contadas com narrativa documental, arquivos históricos, mapas e footage moderno.',
    whyItFits:[
      'Grande variedade de representação visual correta para a mesma ideia.',
      'Nossa sincronização micro-bit → cena funciona especialmente bem com cronologia e lugares.',
      'Footage, fotografia histórica, mapas, gravuras e imagens modernas reduzem dependência de geração paga.'
    ],
    assetAdvantages:['Arquivo histórico','Mapas','Stock urbano','Fotografia','Drone/timelapse'],
    searchSeeds:['city evolution','city history documentary','then and now city','urban history','city transformation'],
    matchTerms:['city evolution','urban history','urban development','city history','megacity','city transformation','historic city','urbanization','fixed camera timelapse','fixed-camera timelapse','fixed view reconstruction','fixed-view reconstruction'],
    exampleAngles:[
      'How Tokyo Became the World’s Largest City',
      'Paris Before the Eiffel Tower',
      'How Dubai Went From Desert to Megacity'
    ]
  },
  {
    id:'universe-space-astronomy',
    name:'Universo, espaço e astronomia',
    fitScore:10,
    tier:'core',
    status:'approved',
    thesis:'Perguntas extraordinárias e fenômenos cósmicos explicados com escalada narrativa e visual cinematográfico.',
    whyItFits:[
      'A narração carrega a história e permite alta flexibilidade visual.',
      'Grande acervo público e institucional de astronomia, observatórios e missões.',
      'Zoom, movimento e transições aumentam muito a percepção de dinamismo neste formato.'
    ],
    assetAdvantages:['NASA/ESA','Observatórios','Simulações','Animações','Imagens geradas'],
    searchSeeds:['space documentary','astronomy explained','universe documentary','black hole documentary','cosmology explained'],
    matchTerms:['astronomy','universe','space documentary','cosmology','black hole','galaxy','nasa','esa','planetary','astrophysics','spacex','starship','satellite','cosmos','planet','moon','europa','mars','rocket','asteroid','comet','telescope'],
    exampleAngles:[
      'What Happens When the Last Star in the Universe Dies?',
      'The Largest Objects Ever Found in the Universe',
      'What Would You See Falling Into a Black Hole?'
    ]
  },
  {
    id:'history-civilizations-empires',
    name:'História, civilizações e impérios',
    fitScore:10,
    tier:'core',
    status:'approved',
    thesis:'Eventos históricos, civilizações e impérios tratados como histórias cinematográficas e cronológicas.',
    whyItFits:[
      'Permite combinar arte, arquivos, mapas, sítios históricos e reconstituições.',
      'Cronologia cria estrutura natural para nossos capítulos e micro-bits.',
      'Tem enorme profundidade temática sem exigir apresentador ou demonstração prática.'
    ],
    assetAdvantages:['Arquivos','Pinturas','Mapas','Ruínas','Reconstituições'],
    searchSeeds:['history documentary','ancient civilization documentary','empire history','historical events documentary','ancient history'],
    matchTerms:['ancient civilization','ancient history','roman empire','empire history','medieval history','civilization','archaeology','pharaoh','viking','historical event','ancient','history of','historical','medieval','roman','egypt'],
    exampleAngles:[
      'The Last 24 Hours of Pompeii',
      'What Life Was Really Like in London in 1666',
      'How the Roman Empire Really Collapsed'
    ]
  },
  {
    id:'geography-countries-borders',
    name:'Geografia, países e fronteiras',
    fitScore:9,
    tier:'expansion',
    status:'approved',
    thesis:'Fenômenos geográficos e políticos explicados por mapas, cidades, satélite e infraestrutura.',
    whyItFits:[
      'Combina mapas, satélite, stock e contexto histórico em uma única narrativa.',
      'Perguntas de “por quê?” geram títulos naturalmente fortes.',
      'Os assets podem ilustrar conceitos sem depender de uma demonstração física específica.'
    ],
    assetAdvantages:['Mapas','Satélite','Stock geográfico','Infraestrutura','Arquivos'],
    searchSeeds:['geography documentary','borders explained','country geography','geopography documentary','why nobody lives'],
    matchTerms:['geography','borders explained','country geography','geopolitics','geopolitical','map explained','why nobody lives','population geography','territory','border','international border','national border'],
    exampleAngles:[
      'Why Nobody Lives in 80% of Australia',
      'The Strange Border Between Belgium and the Netherlands',
      'Why This City Is Sinking'
    ]
  },
  {
    id:'megaprojects-engineering-future-cities',
    name:'Megaprojetos, engenharia e cidades futuras',
    fitScore:9,
    tier:'expansion',
    status:'approved',
    thesis:'Grandes obras e projetos urbanos explicados por escala, custo, engenharia e impacto.',
    whyItFits:[
      'Disponibilidade de renders, drones, mapas e material institucional.',
      'Alto potencial visual e narrativo para vídeos long-form.',
      'Compartilha praticamente o mesmo pipeline de cidades e geografia.'
    ],
    assetAdvantages:['Drone','Renders','Mapas','Obras','Material institucional'],
    searchSeeds:['megaproject documentary','engineering megaprojects','future city documentary','infrastructure documentary','mega construction'],
    matchTerms:['megaproject','mega project','engineering project','infrastructure','future city','construction documentary','bridge engineering','tunnel engineering','airport project','rail project','engineering','engineers','tunnel','bridge','pipeline','railway','airport','construction','desalination','dam','sea wall','high speed rail','chip factory','land reclamation','flood control'],
    exampleAngles:[
      'The $500 Billion City Being Built in the Desert',
      'The Largest Airport Ever Attempted',
      'The Tunnel That Could Change Europe Forever'
    ]
  },
  {
    id:'historical-mysteries-abandoned-places',
    name:'Mistérios históricos e lugares abandonados',
    fitScore:9,
    tier:'expansion',
    status:'approved',
    thesis:'Lugares, eventos e desaparecimentos históricos reconstruídos por evidências e atmosfera.',
    whyItFits:[
      'Grande liberdade de representação visual sem perder coerência factual.',
      'Mistério cria retenção por progressão narrativa.',
      'Funciona com arquivos, mapas, ruínas, documentos e ambientação cinematográfica.'
    ],
    assetAdvantages:['Arquivos','Ruínas','Mapas','Documentos','Atmosfera'],
    searchSeeds:['historical mystery documentary','abandoned places documentary','lost city history','unsolved history','forgotten places'],
    matchTerms:['historical mystery','abandoned place','lost city','unsolved history','forgotten place','ghost town','mysterious history','lost civilization','archaeological mystery','abandoned city','abandoned town','lost settlement'],
    exampleAngles:[
      'The City That Vanished From the Map',
      'Inside the World’s Most Mysterious Abandoned Places',
      'The Lost Civilization Nobody Can Fully Explain'
    ]
  }
];

export const PRIORITY_CONTENT_MODEL_VERSION='priority-content-models@1.1.0';


export function priorityContentModelById(id:string|undefined|null){
  return id?PRIORITY_CONTENT_MODELS.find(model=>model.id===id)??null:null;
}

function normalizePriorityText(value:string){
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}

function priorityTermVariants(term:string){
  if(term.includes(' '))return [term];
  const variants=[term,term+'s'];
  if(term.endsWith('y')&&term.length>2)variants.push(term.slice(0,-1)+'ies');
  return variants;
}

export function priorityTextMatchesTerm(text:string,term:string){
  const clean=normalizePriorityText(text);
  const target=normalizePriorityText(term);
  if(!clean||!target)return false;
  if(target.includes(' '))return (' '+clean+' ').includes(' '+target+' ');
  const tokens=new Set(clean.split(' ').filter(Boolean));
  return priorityTermVariants(target).some(variant=>tokens.has(variant));
}

export function inferPriorityContentModel(text:string){
  if(!normalizePriorityText(text))return null;
  const ranked=PRIORITY_CONTENT_MODELS.map(model=>({
    model,
    score:model.matchTerms.reduce((sum,term)=>sum+(priorityTextMatchesTerm(text,term)?1:0),0)
  })).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||b.model.fitScore-a.model.fitScore);
  return ranked[0]?.model??null;
}

export function priorityDiscoverySeed(model:PriorityContentModel,now=new Date()){
  const day=Math.floor(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())/86400000);
  return model.searchSeeds[Math.abs(day)%model.searchSeeds.length];
}
