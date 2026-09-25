export type TaxonomyOption={value:string;label:string};
export type TaxonomyCity={
  country:string;
  region?:string;
  city:string;
  aliases?:string[];
  districts?:string[];
  landmarks?:string[];
};
export type MediaTaxonomySemantic={
  subjects:string[];
  locations:string[];
  periods:string[];
  countries:string[];
  regions:string[];
  cities:string[];
  districts:string[];
  landmarks:string[];
  scenes:string[];
  objects:string[];
  activities:string[];
  people:string[];
  timeOfDay:string[];
  weather:string[];
  seasons:string[];
  shotTypes:string[];
  cameraMotion:string[];
  moods:string[];
};

type Pattern={label:string;aliases:string[]};

const GEO:TaxonomyCity[]=[
  {country:'United States',region:'New York',city:'New York City',aliases:['new york city','new york','nyc','manhattan'],districts:['Manhattan','Brooklyn','Queens','Bronx','Staten Island','SoHo','Tribeca','Chelsea','Greenwich Village','Harlem','Chinatown','Little Italy','Upper East Side','Upper West Side','Financial District'],landmarks:['Times Square','Empire State Building','Central Park','Statue of Liberty','Brooklyn Bridge','Manhattan Bridge','One World Trade Center','Wall Street','Rockefeller Center','Grand Central Terminal','Chrysler Building','Flatiron Building','Bryant Park','New York Public Library']},
  {country:'United States',region:'California',city:'Los Angeles',aliases:['los angeles','la california'],districts:['Downtown Los Angeles','Hollywood','Beverly Hills','Santa Monica','Venice'],landmarks:['Hollywood Sign','Griffith Observatory','Santa Monica Pier','Hollywood Boulevard']},
  {country:'United States',region:'Nevada',city:'Las Vegas',aliases:['las vegas','vegas'],districts:['Downtown Las Vegas','Las Vegas Strip','Fremont Street'],landmarks:['Bellagio','Caesars Palace','MGM Grand','Luxor','The Venetian','Paris Las Vegas','Sphere Las Vegas','Stratosphere','Golden Gate Hotel','Sal Sagev','El Cortez','Fremont Street Experience']},
  {country:'United States',region:'California',city:'San Francisco',aliases:['san francisco','sf california'],districts:['Downtown San Francisco','Mission District','Chinatown','Fisherman’s Wharf'],landmarks:['Golden Gate Bridge','Alcatraz','Transamerica Pyramid','Ferry Building']},
  {country:'United States',region:'Illinois',city:'Chicago',aliases:['chicago'],districts:['The Loop','River North'],landmarks:['Willis Tower','Millennium Park','Navy Pier','Chicago Riverwalk']},
  {country:'United States',region:'Florida',city:'Miami',aliases:['miami'],districts:['Downtown Miami','Miami Beach','South Beach','Brickell'],landmarks:['Ocean Drive','Bayside Marketplace']},
  {country:'United States',region:'District of Columbia',city:'Washington DC',aliases:['washington dc','washington d c'],landmarks:['White House','US Capitol','Washington Monument','Lincoln Memorial']},
  {country:'United States',region:'Massachusetts',city:'Boston',aliases:['boston'],landmarks:['Boston Common','Fenway Park']},
  {country:'United States',region:'Washington',city:'Seattle',aliases:['seattle'],landmarks:['Space Needle','Pike Place Market']},
  {country:'United States',region:'Texas',city:'Austin',aliases:['austin texas'],landmarks:['Texas State Capitol']},

  {country:'United Kingdom',region:'England',city:'London',aliases:['london'],districts:['Westminster','Soho','Camden','City of London','Canary Wharf'],landmarks:['Big Ben','Tower Bridge','London Eye','Buckingham Palace','Tower of London','Piccadilly Circus']},
  {country:'United Kingdom',region:'England',city:'Manchester',aliases:['manchester']},
  {country:'United Kingdom',region:'England',city:'Liverpool',aliases:['liverpool']},
  {country:'United Kingdom',region:'Scotland',city:'Edinburgh',aliases:['edinburgh'],landmarks:['Edinburgh Castle']},
  {country:'United Kingdom',region:'England',city:'Birmingham',aliases:['birmingham uk']},
  {country:'United Kingdom',region:'England',city:'Oxford',aliases:['oxford england']},
  {country:'United Kingdom',region:'England',city:'Cambridge',aliases:['cambridge england']},

  {country:'France',city:'Paris',aliases:['paris france','paris'],districts:['Montmartre','Le Marais','Latin Quarter'],landmarks:['Eiffel Tower','Arc de Triomphe','Louvre Museum','Notre Dame','Sacré-Cœur']},
  {country:'France',city:'Marseille',aliases:['marseille']},{country:'France',city:'Lyon',aliases:['lyon france']},{country:'France',city:'Nice',aliases:['nice france']},{country:'France',city:'Bordeaux',aliases:['bordeaux']},

  {country:'Italy',city:'Rome',aliases:['rome italy','roma'],landmarks:['Colosseum','Trevi Fountain','Pantheon','Roman Forum','Vatican City']},
  {country:'Italy',city:'Milan',aliases:['milan italy','milano']},{country:'Italy',city:'Venice',aliases:['venice italy','venezia'],landmarks:['St Mark’s Square','Rialto Bridge']},{country:'Italy',city:'Florence',aliases:['florence italy','firenze']},{country:'Italy',city:'Naples',aliases:['naples italy','napoli']},

  {country:'Spain',city:'Madrid',aliases:['madrid']},{country:'Spain',city:'Barcelona',aliases:['barcelona'],landmarks:['Sagrada Familia','Park Güell']},{country:'Spain',city:'Valencia',aliases:['valencia spain']},{country:'Spain',city:'Seville',aliases:['seville','sevilla']},{country:'Spain',city:'Malaga',aliases:['malaga']},

  {country:'Germany',city:'Berlin',aliases:['berlin'],landmarks:['Brandenburg Gate','Reichstag']},{country:'Germany',city:'Munich',aliases:['munich','münchen']},{country:'Germany',city:'Frankfurt',aliases:['frankfurt']},{country:'Germany',city:'Hamburg',aliases:['hamburg']},{country:'Germany',city:'Cologne',aliases:['cologne','köln']},

  {country:'Japan',city:'Tokyo',aliases:['tokyo'],districts:['Shibuya','Shinjuku','Ginza','Akihabara'],landmarks:['Tokyo Tower','Tokyo Skytree','Shibuya Crossing']},
  {country:'Japan',city:'Osaka',aliases:['osaka']},{country:'Japan',city:'Kyoto',aliases:['kyoto']},{country:'Japan',city:'Yokohama',aliases:['yokohama']},{country:'Japan',city:'Hiroshima',aliases:['hiroshima']},

  {country:'China',city:'Beijing',aliases:['beijing']},{country:'China',city:'Shanghai',aliases:['shanghai']},{country:'China',city:'Shenzhen',aliases:['shenzhen']},{country:'China',city:'Guangzhou',aliases:['guangzhou']},{country:'China',city:'Hong Kong',aliases:['hong kong']},

  {country:'South Korea',city:'Seoul',aliases:['seoul'],districts:['Gangnam']},{country:'South Korea',city:'Busan',aliases:['busan']},{country:'South Korea',city:'Incheon',aliases:['incheon']},

  {country:'Canada',region:'Ontario',city:'Toronto',aliases:['toronto'],landmarks:['CN Tower']},{country:'Canada',region:'British Columbia',city:'Vancouver',aliases:['vancouver']},{country:'Canada',region:'Quebec',city:'Montreal',aliases:['montreal']},{country:'Canada',region:'Ontario',city:'Ottawa',aliases:['ottawa']},{country:'Canada',region:'Alberta',city:'Calgary',aliases:['calgary']},

  {country:'Australia',region:'New South Wales',city:'Sydney',aliases:['sydney australia'],landmarks:['Sydney Opera House','Sydney Harbour Bridge']},{country:'Australia',region:'Victoria',city:'Melbourne',aliases:['melbourne']},{country:'Australia',region:'Queensland',city:'Brisbane',aliases:['brisbane']},{country:'Australia',region:'Western Australia',city:'Perth',aliases:['perth australia']},

  {country:'Brazil',region:'São Paulo',city:'São Paulo',aliases:['sao paulo','são paulo'],landmarks:['Paulista Avenue','Ibirapuera Park']},{country:'Brazil',region:'Rio de Janeiro',city:'Rio de Janeiro',aliases:['rio de janeiro','rio brazil'],landmarks:['Christ the Redeemer','Sugarloaf Mountain','Copacabana','Ipanema']},{country:'Brazil',region:'Distrito Federal',city:'Brasília',aliases:['brasilia','brasília']},{country:'Brazil',region:'Bahia',city:'Salvador',aliases:['salvador brazil']},{country:'Brazil',region:'Pernambuco',city:'Recife',aliases:['recife']},

  {country:'Mexico',city:'Mexico City',aliases:['mexico city','ciudad de mexico']},{country:'Mexico',city:'Cancun',aliases:['cancun','cancún']},{country:'Mexico',city:'Guadalajara',aliases:['guadalajara']},{country:'Mexico',city:'Monterrey',aliases:['monterrey']},

  {country:'United Arab Emirates',city:'Dubai',aliases:['dubai'],landmarks:['Burj Khalifa','Burj Al Arab','Dubai Marina','Palm Jumeirah']},{country:'United Arab Emirates',city:'Abu Dhabi',aliases:['abu dhabi']},
  {country:'Singapore',city:'Singapore',aliases:['singapore'],landmarks:['Marina Bay Sands','Gardens by the Bay']},
  {country:'Netherlands',city:'Amsterdam',aliases:['amsterdam']},{country:'Netherlands',city:'Rotterdam',aliases:['rotterdam']},{country:'Netherlands',city:'The Hague',aliases:['the hague','den haag']},
  {country:'Switzerland',city:'Zurich',aliases:['zurich','zürich']},{country:'Switzerland',city:'Geneva',aliases:['geneva']},{country:'Switzerland',city:'Lucerne',aliases:['lucerne']},
  {country:'Austria',city:'Vienna',aliases:['vienna','wien']},{country:'Austria',city:'Salzburg',aliases:['salzburg']},
  {country:'Turkey',city:'Istanbul',aliases:['istanbul']},{country:'Turkey',city:'Ankara',aliases:['ankara']},
  {country:'India',city:'Mumbai',aliases:['mumbai','bombay']},{country:'India',city:'Delhi',aliases:['new delhi','delhi']},{country:'India',city:'Bangalore',aliases:['bangalore','bengaluru']},{country:'India',city:'Kolkata',aliases:['kolkata','calcutta']},{country:'India',city:'Jaipur',aliases:['jaipur']}
];

const SCENES:Pattern[]=[
  {label:'skyline',aliases:['skyline','cityscape','panoramic city']},
  {label:'buildings',aliases:['building','buildings','skyscraper','skyscrapers','architecture','office building','residential building']},
  {label:'street',aliases:['street','urban street','downtown street']},
  {label:'avenue',aliases:['avenue','boulevard','main avenue']},
  {label:'traffic',aliases:['traffic','rush hour','intersection','cars on road']},
  {label:'pedestrians',aliases:['pedestrian','pedestrians','people walking','walking people','crowd','commuters']},
  {label:'restaurants',aliases:['restaurant','restaurants','outdoor dining','dining district']},
  {label:'cafes',aliases:['cafe','coffee shop','coffee house']},
  {label:'nightlife',aliases:['nightlife','night club','nightclub','bars','entertainment district']},
  {label:'shopping',aliases:['shop','shops','shopping street','retail store','storefront','shopping mall','shopping center']},
  {label:'hotels',aliases:['hotel','hotels','hotel lobby','hotel exterior']},
  {label:'libraries',aliases:['library','libraries','public library']},
  {label:'museums',aliases:['museum','museums','art museum']},
  {label:'universities',aliases:['university','college campus','campus']},
  {label:'parks',aliases:['park','city park','urban park']},
  {label:'public square',aliases:['public square','city square','plaza','town square']},
  {label:'tourist attractions',aliases:['tourist attraction','tourist attractions','landmark','tourists']},
  {label:'monuments',aliases:['monument','memorial','statue']},
  {label:'bridges',aliases:['bridge','bridges']},
  {label:'riverfront',aliases:['river','riverfront','waterfront']},
  {label:'harbor',aliases:['harbor','harbour','port','marina']},
  {label:'beach',aliases:['beach','coast','oceanfront']},
  {label:'airport',aliases:['airport','airport terminal','airplane landing']},
  {label:'rail station',aliases:['train station','railway station','rail station']},
  {label:'subway',aliases:['subway','metro station','metro train','underground station']},
  {label:'bus transit',aliases:['city bus','bus station','public transport']},
  {label:'taxi',aliases:['taxi','cab traffic','yellow taxi']},
  {label:'highway',aliases:['highway','freeway','interstate','road traffic']},
  {label:'industrial',aliases:['factory','industrial district','warehouse','industrial area']},
  {label:'construction',aliases:['construction site','construction','crane']},
  {label:'offices',aliases:['office','corporate office','business district']},
  {label:'market',aliases:['street market','food market','farmers market','market']},
  {label:'street food',aliases:['street food','food vendor','food stand']},
  {label:'religious architecture',aliases:['church','cathedral','temple','mosque','religious building']},
  {label:'hospital',aliases:['hospital','medical center']},
  {label:'emergency',aliases:['police car','fire department','ambulance','emergency response']},
  {label:'mountains',aliases:['mountain','mountains','mountain range','valley']},
  {label:'desert',aliases:['desert','sand dunes','arid landscape']},
  {label:'forest',aliases:['forest','woods','woodland']},
  {label:'nature',aliases:['nature','landscape','scenic landscape']}
];

const OBJECTS:Pattern[]=[
  {label:'buildings',aliases:['building','buildings','skyscraper','skyscrapers']},
  {label:'cars',aliases:['car','cars','vehicles','traffic']},{label:'roads',aliases:['road','street','avenue','boulevard','highway']},
  {label:'neon signs',aliases:['neon','neon sign','neon signs']},{label:'trees',aliases:['tree','trees']},
  {label:'mountains',aliases:['mountain','mountains']},{label:'water',aliases:['river','ocean','sea','lake','waterfront']},
  {label:'aircraft',aliases:['airplane','aircraft','plane']},{label:'trains',aliases:['train','subway','metro']},
  {label:'buses',aliases:['bus','buses']},{label:'boats',aliases:['boat','boats','ship','ships']}
];
const ACTIVITIES:Pattern[]=[
  {label:'walking',aliases:['walking','people walking','pedestrians']},{label:'driving',aliases:['driving','drive','traffic']},
  {label:'commuting',aliases:['commuters','commuting','rush hour']},{label:'shopping',aliases:['shopping']},
  {label:'dining',aliases:['dining','restaurant','eating']},{label:'touring',aliases:['tourists','tourist','sightseeing']},
  {label:'working',aliases:['working','office workers']},{label:'cycling',aliases:['cycling','bicycle','bike riding']}
];
const PEOPLE:Pattern[]=[
  {label:'pedestrians',aliases:['pedestrian','pedestrians','people walking']},{label:'crowd',aliases:['crowd','crowded']},
  {label:'commuters',aliases:['commuters','rush hour']},{label:'tourists',aliases:['tourists','tourist']},
  {label:'workers',aliases:['workers','office workers']},{label:'students',aliases:['students','student']}
];
const TIME:Pattern[]=[
  {label:'morning',aliases:['morning']},{label:'sunrise',aliases:['sunrise','dawn']},{label:'daytime',aliases:['daytime','day light','daylight']},
  {label:'afternoon',aliases:['afternoon']},{label:'sunset',aliases:['sunset','dusk','golden hour']},{label:'blue hour',aliases:['blue hour']},
  {label:'night',aliases:['night','nighttime','late night']}
];
const WEATHER:Pattern[]=[
  {label:'sunny',aliases:['sunny','clear sky']},{label:'cloudy',aliases:['cloudy']},{label:'overcast',aliases:['overcast']},
  {label:'rain',aliases:['rain','raining','rainy']},{label:'snow',aliases:['snow','snowing','snowy']},
  {label:'fog',aliases:['fog','foggy','mist','misty']},{label:'storm',aliases:['storm','stormy']}
];
const SEASONS:Pattern[]=[
  {label:'spring',aliases:['spring']},{label:'summer',aliases:['summer']},{label:'autumn',aliases:['autumn','fall']},{label:'winter',aliases:['winter']}
];
const SHOTS:Pattern[]=[
  {label:'aerial',aliases:['aerial','aerial view']},{label:'drone',aliases:['drone','drone view']},{label:'bird-eye',aliases:['bird eye','birds eye','bird-eye']},
  {label:'top-down',aliases:['top down','top-down']},{label:'high-angle',aliases:['high angle','high-angle']},
  {label:'street-level',aliases:['street level','street-level']},{label:'eye-level',aliases:['eye level','eye-level']},{label:'ground-level',aliases:['ground level','ground-level']},
  {label:'pov',aliases:['pov','point of view']},{label:'driving-pov',aliases:['driving pov']},{label:'walking-pov',aliases:['walking pov']},
  {label:'window-view',aliases:['window view']},{label:'rooftop-view',aliases:['rooftop view']},{label:'wide',aliases:['wide shot','wide view']},
  {label:'medium',aliases:['medium shot']},{label:'close-up',aliases:['close up','close-up','closeup']},{label:'telephoto',aliases:['telephoto']},{label:'establishing',aliases:['establishing shot']}
];
const MOTION:Pattern[]=[
  {label:'static',aliases:['static','tripod']},{label:'pan',aliases:['pan','panning']},{label:'tilt',aliases:['tilt','tilting']},
  {label:'tracking',aliases:['tracking shot','tracking']},{label:'dolly',aliases:['dolly']},{label:'orbit',aliases:['orbit']},
  {label:'drone-flyover',aliases:['drone flyover','flyover']},{label:'drone-approach',aliases:['drone approach','approach']},
  {label:'drone-pullback',aliases:['drone pullback','pullback']},{label:'timelapse',aliases:['timelapse','time lapse','time-lapse']},
  {label:'hyperlapse',aliases:['hyperlapse']},{label:'slow-motion',aliases:['slow motion','slow-motion']}
];
const MOODS:Pattern[]=[
  {label:'busy',aliases:['busy','crowded','rush hour']},{label:'empty',aliases:['empty','deserted','quiet street']},
  {label:'cinematic',aliases:['cinematic']},{label:'calm',aliases:['calm','peaceful']},{label:'dramatic',aliases:['dramatic']},
  {label:'vibrant',aliases:['vibrant','colorful']},{label:'moody',aliases:['moody']}
];

function normalize(value:string){
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function includesPhrase(haystack:string,needle:string){
  const n=normalize(needle);
  return n.length>1&&(' '+haystack+' ').includes(' '+n+' ');
}
function unique(values:string[],limit=80){
  return [...new Set(values.map(v=>v.trim().toLowerCase()).filter(Boolean))].slice(0,limit);
}
function labelsFor(text:string,patterns:Pattern[]){
  return unique(patterns.filter(p=>p.aliases.some(alias=>includesPhrase(text,alias))).map(p=>p.label));
}
function labelOptions(values:string[]):TaxonomyOption[]{
  return [...new Set(values)].sort((a,b)=>a.localeCompare(b)).map(label=>({value:label.toLowerCase(),label}));
}

export function classifyMediaTaxonomy(value:string):MediaTaxonomySemantic{
  const text=normalize(value);
  const matchedCities=GEO.filter(item=>
    [item.city,...(item.aliases??[])].some(alias=>includesPhrase(text,alias))
  );
  const countries=unique(matchedCities.map(item=>item.country));
  const regions=unique(matchedCities.map(item=>item.region??''));
  const cities=unique(matchedCities.map(item=>item.city));
  const districts=unique(matchedCities.flatMap(item=>
    (item.districts??[]).filter(name=>includesPhrase(text,name))
  ));
  const landmarks=unique(matchedCities.flatMap(item=>
    (item.landmarks??[]).filter(name=>includesPhrase(text,name))
  ));
  const scenes=labelsFor(text,SCENES);
  const objects=labelsFor(text,OBJECTS);
  const activities=labelsFor(text,ACTIVITIES);
  const people=labelsFor(text,PEOPLE);
  const timeOfDay=labelsFor(text,TIME);
  const weather=labelsFor(text,WEATHER);
  const seasons=labelsFor(text,SEASONS);
  const shotTypes=labelsFor(text,SHOTS);
  const cameraMotion=labelsFor(text,MOTION);
  const moods=labelsFor(text,MOODS);
  const locations=unique([...countries,...regions,...cities,...districts,...landmarks]);
  const periods=unique([...timeOfDay,...seasons]);
  return {
    subjects:[],locations,periods,countries,regions,cities,districts,landmarks,scenes,objects,
    activities,people,timeOfDay,weather,seasons,shotTypes,cameraMotion,moods
  };
}

export function mediaTaxonomyCatalog(){
  const countries=labelOptions(GEO.map(item=>item.country));
  const citiesByCountry:Record<string,TaxonomyOption[]>={};
  for(const country of countries){
    citiesByCountry[country.value]=labelOptions(GEO.filter(item=>item.country.toLowerCase()===country.value).map(item=>item.city));
  }
  return {
    version:1,
    countries,
    citiesByCountry,
    scenes:labelOptions(SCENES.map(item=>item.label)),
    timeOfDay:labelOptions(TIME.map(item=>item.label)),
    weather:labelOptions(WEATHER.map(item=>item.label)),
    seasons:labelOptions(SEASONS.map(item=>item.label)),
    shotTypes:labelOptions(SHOTS.map(item=>item.label)),
    cameraMotion:labelOptions(MOTION.map(item=>item.label))
  };
}

export const MEDIA_TAXONOMY_VERSION=1;
