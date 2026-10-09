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
    exampleAngles:[
      'The City That Vanished From the Map',
      'Inside the World’s Most Mysterious Abandoned Places',
      'The Lost Civilization Nobody Can Fully Explain'
    ]
  }
];

export const PRIORITY_CONTENT_MODEL_VERSION='priority-content-models@1.0.0';
