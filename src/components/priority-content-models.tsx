'use client';

import { ArrowUpRight, CheckCircle2, Layers3, Search, Sparkles } from 'lucide-react';
import type { PriorityContentModel } from '@/lib/priority-content-models';

export default function PriorityContentModels({models}:{models:PriorityContentModel[]}){
  const core=models.filter(model=>model.tier==='core');
  const expansion=models.filter(model=>model.tier==='expansion');
  return <section className="priority-models">
    <div className="priority-models-head">
      <div>
        <div className="briefing-label"><span className="briefing-pip"/>ESTRATÉGIA APROVADA</div>
        <h2>Modelos prioritários <span className="count-pill">{models.length}</span></h2>
        <p>Somente formatos com fit 9/10 ou 10/10 com nossa inteligência, sourcing e infraestrutura de produção.</p>
      </div>
      <div className="priority-model-summary">
        <span><strong>{core.length}</strong> CORE · 10/10</span>
        <span><strong>{expansion.length}</strong> EXPANSÃO · 9/10</span>
      </div>
    </div>

    <div className="priority-model-grid">
      {models.map((model,index)=><article className={'priority-model-card tier-'+model.tier} key={model.id}>
        <div className="priority-model-top">
          <span className="priority-model-index">{String(index+1).padStart(2,'0')}</span>
          <span className={'priority-fit fit-'+model.fitScore}>{model.fitScore}/10</span>
        </div>
        <div className="priority-model-tier">
          {model.tier==='core'?<Sparkles size={14}/>:<Layers3 size={14}/>} 
          {model.tier==='core'?'CORE':'EXPANSÃO'}
          <span><CheckCircle2 size={13}/> aprovado</span>
        </div>
        <h3>{model.name}</h3>
        <p>{model.thesis}</p>

        <div className="priority-model-section">
          <span>POR QUE ENCAIXA</span>
          <ul>{model.whyItFits.map(item=><li key={item}>{item}</li>)}</ul>
        </div>

        <div className="priority-model-assets">
          {model.assetAdvantages.map(item=><span key={item}>{item}</span>)}
        </div>

        <details>
          <summary><Search size={14}/> Exemplos e sementes de pesquisa <ArrowUpRight size={14}/></summary>
          <div className="priority-model-examples">
            {model.exampleAngles.map(item=><p key={item}>{item}</p>)}
            <small>Seeds: {model.searchSeeds.join(' · ')}</small>
          </div>
        </details>
      </article>)}
    </div>
  </section>;
}