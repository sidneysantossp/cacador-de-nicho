'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BarChart3, BrainCircuit, Clock3, ExternalLink, Eye, MessageSquareText, Play, Search, Sparkles, Target, UsersRound } from 'lucide-react';
import type { ChannelStudy, OpportunityReport } from '@/lib/types';

function compact(n:number){
  return new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(n);
}
function ageHours(publishedAt:string){
  return Math.max(0,Math.floor((Date.now()-new Date(publishedAt).getTime())/3600000));
}
function formatDuration(iso:string){
  const m=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if(!m)return iso;
  const hours=Number(m[2]??0),minutes=Number(m[3]??0),seconds=Math.round(Number(m[4]??0));
  return hours?`${hours}h ${String(minutes).padStart(2,'0')}m`:`${minutes}:${String(seconds).padStart(2,'0')}`;
}
function ListBlock({title,items}:{title:string;items:string[]}){
  if(!items.length)return null;
  return <section className="study-list-block"><h3>{title}</h3><ul>{items.map((item,i)=><li key={`${title}-${i}`}>{item}</li>)}</ul></section>;
}

export default function ChannelAnalysis({
  studies,
  reports,
  mode,
  busy,
  onAnalyze,
  onGenerateReport,
  selectedStudyId
}:{
  studies:ChannelStudy[];
  reports:OpportunityReport[];
  mode:'demo'|'live';
  busy:string;
  onAnalyze:(input:string)=>Promise<boolean|undefined>;
  onGenerateReport:(channelStudyId:string)=>Promise<boolean|undefined>;
  selectedStudyId?:string;
}){
  const [input,setInput]=useState('');
  const [selectedId,setSelectedId]=useState(selectedStudyId??studies[0]?.id??'');
  useEffect(()=>{if(studies.length&&!studies.some(s=>s.id===selectedId))setSelectedId(studies[0].id);},[studies,selectedId]);
  useEffect(()=>{if(selectedStudyId&&studies.some(s=>s.id===selectedStudyId))setSelectedId(selectedStudyId);},[selectedStudyId,studies]);
  const study=useMemo(()=>studies.find(s=>s.id===selectedId)??studies[0]??null,[studies,selectedId]);
  const report=useMemo(()=>study?reports.find(item=>item.channelStudyId===study.id)??null:null,[reports,study]);

  return <>
    <section className="channel-analysis-hero">
      <div>
        <span className="eyebrow">ANATOMIA DE CANAL <span>/</span> NICHE LOCK</span>
        <h2>Descubra <span>por que viralizou</span> — sem sair do nicho.</h2>
        <p>Informe um canal. O motor desmonta os 10 long forms com mais views, amostra comentários públicos, identifica mecanismos repetíveis e procura canais pequenos do mesmo nicho que já estejam rompendo.</p>
      </div>
      <form className="channel-analysis-form" onSubmit={async e=>{e.preventDefault();if(mode==='demo'||!input.trim())return;const ok=await onAnalyze(input.trim());if(ok)setInput('');}}>
        <label>
          Canal, @handle ou URL do YouTube
          <div className="channel-input-row">
            <input value={input} onChange={e=>setInput(e.target.value)} placeholder="https://youtube.com/@canal ou @canal" disabled={mode==='demo'||!!busy}/>
            <button className="button primary" disabled={mode==='demo'||!!busy||!input.trim()}>
              <BrainCircuit size={17}/>{busy==='channelStudy'?'Analisando…':'Analisar canal'}
            </button>
          </div>
        </label>
        <small>{mode==='demo'?'Entre na operação para analisar um canal real.':'US English + long form para a busca de similares. Quando search.list estiver indisponível, a anatomia usa os uploads públicos recentes do próprio canal.'}</small>
      </form>
    </section>

    {studies.length>0&&<div className="study-history">
      <span>Análises salvas</span>
      <div>{studies.map(item=><button key={item.id} className={item.id===study?.id?'selected':''} onClick={()=>setSelectedId(item.id)}>{item.source.name}</button>)}</div>
    </div>}

    {!study&&<div className="empty-state">
      <span className="empty-icon"><BrainCircuit size={30}/></span>
      <h3>Nenhum canal analisado ainda</h3>
      <p>Comece por um canal que você considera validado. A análise não depende dos filtros de tamanho do Radar para o canal de origem; os filtros rígidos são aplicados aos similares encontrados.</p>
    </div>}

    {study&&<>
      <section className="study-source">
        <div className="study-source-main">
          {study.source.avatar?<img src={study.source.avatar} alt="" className="study-avatar"/>:<span className="study-avatar placeholder">{study.source.name.slice(0,2).toUpperCase()}</span>}
          <div>
            <span className="eyebrow">CANAL DE ORIGEM</span>
            <h2>{study.source.name}</h2>
            <p>{study.source.description||'Sem descrição pública.'}</p>
            <a href={study.source.url} target="_blank" rel="noreferrer">Abrir canal <ExternalLink size={13}/></a>
          </div>
        </div>
        <div className="study-source-metrics">
          <div><UsersRound size={17}/><span>Inscritos<strong>{study.source.subscribers===null?'Ocultos':compact(study.source.subscribers)}</strong></span></div>
          <div><Play size={17}/><span>Vídeos públicos<strong>{study.totalPublicVideos}</strong></span></div>
          <div><Eye size={17}/><span>Views Top 10<strong>{compact(study.metrics.top10Views)}</strong></span></div>
          <div><BarChart3 size={17}/><span>Top 3 / Top 10<strong>{Math.round(study.metrics.top3Share*100)}%</strong></span></div>
        </div>
      </section>

      <section className="niche-lock-panel">
        <div className="niche-lock-title"><Target size={21}/><div><span className="eyebrow">NICHE LOCK</span><h2>{study.nicheProfile.primaryNiche} <span>→ {study.nicheProfile.subniche}</span></h2></div></div>
        <p>{study.nicheProfile.audienceIntent}</p>
        <div className="niche-lock-grid">
          <div><strong>Temas centrais</strong><div className="study-chips">{study.nicheProfile.coreTopics.map(x=><span key={x}>{x}</span>)}</div></div>
          <div><strong>Âncoras obrigatórias</strong><div className="study-chips">{study.nicheProfile.anchorTerms.map(x=><span key={x}>{x}</span>)}</div></div>
          <div><strong>Adjacências proibidas</strong><div className="study-chips danger">{study.nicheProfile.excludedAdjacentTopics.map(x=><span key={x}>{x}</span>)}</div></div>
          <div><strong>Assinatura de formato</strong><p>{study.nicheProfile.formatSignature}</p></div>
        </div>
      </section>

      <section className="opportunity-report-shell">
        <div className="opportunity-report-head">
          <div>
            <span className="eyebrow">OPPORTUNITY REPORT <span>/</span> COPY THE CURVE, NOT THE NICHE</span>
            <h2>{report?report.title:'Transforme esta anatomia em uma oportunidade executável.'}</h2>
            <p>{report?report.thesis:'A engine abstrai a curva do canal, testa o quanto ela é estrutural, identifica saturação e lacunas e cria três transferências sem confundir hipótese com demanda comprovada.'}</p>
          </div>
          <button className="button primary opportunity-report-button" disabled={mode==='demo'||!!busy} onClick={()=>study&&void onGenerateReport(study.id)}>
            <Sparkles size={17}/>{busy==='opportunityReport'?'Gerando relatório…':report?'Atualizar Opportunity Report':'Gerar Opportunity Report'}
          </button>
        </div>

        {report&&<>
          <div className="curve-card">
            <span className="eyebrow">A CURVA</span>
            <h3>{report.curve.thesis}</h3>
            <div className="curve-flow">
              <div><small>ASSUNTO</small><strong>{report.curve.subject}</strong></div>
              <span>→</span>
              <div><small>PROMESSA</small><strong>{report.curve.promise}</strong></div>
              <span>→</span>
              <div><small>ÂNGULO</small><strong>{report.curve.angle}</strong></div>
              <span>→</span>
              <div><small>MECANISMO</small><strong>{report.curve.narrativeMechanism}</strong></div>
              <span>→</span>
              <div><small>VISUAL</small><strong>{report.curve.visualMechanism}</strong></div>
            </div>
            <p><strong>Driver:</strong> {report.curve.emotionalDriver}</p>
          </div>

          <div className="report-validation">
            <div>
              <span className="eyebrow">VALIDAÇÃO ESTRUTURAL</span>
              <strong className={`validation-state ${report.validation.classification}`}>{report.validation.classification}</strong>
              <p>{report.validation.independentCreators} criador(es) independente(s) · {report.validation.supportingVideos} vídeo(s) usados como suporte da amostra.</p>
            </div>
            <ListBlock title="Evidência que sustenta a curva" items={report.validation.evidence}/>
            <ListBlock title="Contraevidência / fragilidades" items={report.validation.counterEvidence}/>
          </div>

          <div className="viral-dna">
            {([
              ['Demanda',report.viralDNA.demand],
              ['Repetibilidade',report.viralDNA.repeatability],
              ['Breakout',report.viralDNA.breakout],
              ['Saturação',report.viralDNA.saturation],
              ['Lacuna',report.viralDNA.gap]
            ] as const).map(([label,signal])=><div key={label} className={`dna-cell ${signal.level}`}><span>{label}</span><strong>{signal.level}</strong><p>{signal.rationale}</p></div>)}
          </div>

          <div className="report-three-column">
            <ListBlock title="Já saturado na amostra" items={report.saturation.saturatedPatterns}/>
            <ListBlock title="Ângulos pouco usados" items={report.saturation.underusedAngles}/>
            <ListBlock title="Whitespace observado" items={report.saturation.whitespace}/>
          </div>

          <div className="section-heading report-section-title"><div><h2>Copie a curva. Não o canal.</h2><p>Três transferências deliberadas. O status de demanda mostra onde há evidência e onde ainda estamos criando uma hipótese.</p></div></div>
          <div className="transfer-grid">
            {report.transfers.map((transfer,index)=><article className="transfer-card" key={transfer.id}>
              <div className="opportunity-top"><span className="big-number">{String(index+1).padStart(2,'0')}</span><span className={`tag ${transfer.demandStatus==='observed'?'green':transfer.demandStatus==='partial'?'blue':'orange'}`}>{transfer.demandStatus}</span></div>
              <span className="transfer-label">{transfer.label}</span>
              <h3>{transfer.targetNiche}</h3>
              <p>{transfer.principle}</p>
              <dl>
                <dt>Mantém</dt><dd>{transfer.preservedMechanism}</dd>
                <dt>Muda</dt><dd>{transfer.changedVariable}</dd>
                <dt>Público</dt><dd>{transfer.targetAudience}</dd>
                <dt>Lacuna</dt><dd>{transfer.gap}</dd>
              </dl>
              {transfer.demandEvidence.length>0&&<div className="transfer-evidence"><strong>Evidência disponível</strong>{transfer.demandEvidence.map((item,i)=><p key={i}>{item}</p>)}</div>}
              <div className="transfer-titles"><strong>Primeiros títulos</strong><ol>{transfer.titles.map(title=><li key={title}>{title}</li>)}</ol></div>
              {transfer.risks.length>0&&<div className="transfer-risks"><strong>Riscos</strong><ul>{transfer.risks.map(risk=><li key={risk}>{risk}</li>)}</ul></div>}
            </article>)}
          </div>

          <section className="channel-blueprint">
            <div className="channel-blueprint-head">
              <div><span className="eyebrow">BUILD THIS CHANNEL</span><h2>{report.channelConcept.nameDirections[0]??'Channel concept'}</h2><p>{report.channelConcept.positioning}</p></div>
              <div className="study-chips">{report.channelConcept.nameDirections.map(name=><span key={name}>{name}</span>)}</div>
            </div>
            <div className="blueprint-grid">
              <div><span>Público</span><p>{report.channelConcept.audience}</p></div>
              <div><span>Promessa</span><p>{report.channelConcept.promise}</p></div>
              <div><span>Formato</span><p>{report.channelConcept.format}</p></div>
              <div><span>Sistema de thumbnail</span><p>{report.channelConcept.thumbnailSystem}</p></div>
              <div><span>Modelo de produção</span><p>{report.channelConcept.productionModel}</p></div>
              <div><span>Próximo movimento</span><p>{report.nextMove}</p></div>
            </div>
            <div className="episode-plan"><span className="eyebrow">PRIMEIROS 10 EPISÓDIOS</span><ol>{report.channelConcept.firstEpisodes.map(title=><li key={title}>{title}</li>)}</ol></div>
            <ListBlock title="Plano de teste" items={report.channelConcept.testPlan}/>
          </section>

          <div className="report-evidence">
            <div>
              <h3>Vídeos que sustentam a leitura</h3>
              {report.evidence.topVideos.slice(0,5).map(video=><a key={video.id} href={video.url} target="_blank" rel="noreferrer"><span>{video.title}</span><strong>{compact(video.views)} views</strong></a>)}
            </div>
            <div>
              <h3>Criadores independentes relacionados</h3>
              {report.evidence.similarChannels.length?report.evidence.similarChannels.map(channel=><a key={channel.id} href={channel.url} target="_blank" rel="noreferrer"><span>{channel.name}</span><strong>{channel.similarityScore}% nicho · {compact(channel.videoViews)} views</strong></a>):<p>Nenhum outro canal passou os gates nesta rodada; por isso a curva não pode ser tratada como estrutural.</p>}
            </div>
          </div>

          <ListBlock title="Limitações do Opportunity Report" items={[...report.validation.limitations,...report.limitations]}/>
        </>}
      </section>

      {study.topSampleScope==='recent-uploads'&&<div className="info-strip"><Clock3 size={18}/><span><strong>Modo sem search.list:</strong> estes são os long forms com mais views dentro de até 100 uploads públicos recentes inspecionados. Não representam necessariamente os maiores vídeos históricos do canal.</span></div>}
      <div className="section-heading"><div><h2>{study.topSampleScope==='recent-uploads'?'Top long forms da amostra recente':'Top 10 long forms por views'} <span className="count-pill">{study.topVideos.length}</span></h2><p>Metadados públicos; comentários são uma amostra de relevância quando estão disponíveis.</p></div></div>
      <div className="study-video-list">
        {study.topVideos.map((video,index)=><article className="study-video" key={video.id}>
          <span className="study-rank">{String(index+1).padStart(2,'0')}</span>
          <img src={video.thumbnail} alt="" />
          <div className="study-video-main">
            <a href={video.url} target="_blank" rel="noreferrer"><h3>{video.title}</h3><ArrowUpRight size={14}/></a>
            <div className="study-video-meta">
              <span><Eye size={13}/>{compact(video.views)} views</span>
              <span><Clock3 size={13}/>{formatDuration(video.duration)}</span>
              <span><MessageSquareText size={13}/>{video.commentCount===null?'—':compact(video.commentCount)} comentários</span>
              <span>{ageHours(video.publishedAt)}h desde publicação</span><span>{video.velocity.baseline?'Baseline criado':`+${compact(video.velocity.deltaViews??0)} em ${(video.velocity.deltaHours??0).toFixed(1)}h · ${compact(video.velocity.viewsPerHour??0)}/h`}</span>
            </div>
            {video.comments.length>0&&<div className="study-comments">
              {video.comments.slice(0,3).map((comment,i)=><p key={i}>“{comment.text}” {comment.likes>0&&<small>♥ {compact(comment.likes)}</small>}</p>)}
            </div>}
          </div>
        </article>)}
      </div>

      <div className="study-anatomy-grid">
        <section className="panel study-summary">
          <div className="panel-heading"><Sparkles size={20}/><h2>Anatomia da viralização</h2></div>
          <p>{study.anatomy.executiveSummary}</p>
          <div className="study-health">
            <div><span>Sustainability</span><strong>{Math.round(study.anatomy.sustainability.score)}/100</strong><small>{study.anatomy.sustainability.classification}</small></div>
            <div><span>Mediana Top 10</span><strong>{compact(study.metrics.medianTop10Views)}</strong></div>
            <div><span>Hit / fraco</span><strong>{study.metrics.hitToWeakMedianRatio===null?'—':study.metrics.hitToWeakMedianRatio.toFixed(1)+'×'}</strong></div>
            <div><span>Velocidade rastreada</span><strong>{study.metrics.velocityTrackedVideos}/{study.topVideos.length}</strong></div>
            <div><span>Hits &gt; inscritos</span><strong>{study.metrics.videosAboveSubscribers===null?'—':study.metrics.videosAboveSubscribers}</strong></div>
            <div><span>Comentários amostrados</span><strong>{study.commentSampleSize}</strong></div>
            <div><span>Vídeos com comentários</span><strong>{study.commentsAvailableVideos}/{study.topVideos.length}</strong></div>
            <div><span>Amostra de contraste</span><strong>{study.comparisonSampleSize}</strong></div>
          </div>
        </section>
        <div>
          <ListBlock title="Mecanismos repetíveis" items={study.anatomy.repeatableMechanisms}/>
          <ListBlock title="Risco de one-hit" items={study.anatomy.oneOffRisks}/>
        </div>
        <div>
          <ListBlock title="Padrões de títulos" items={study.anatomy.titlePatterns}/>
          <ListBlock title="Clusters de temas" items={study.anatomy.topicClusters}/>
        </div>
        <div>
          <ListBlock title="Sinais dos comentários" items={study.anatomy.commentSignals}/>
          <ListBlock title="Perguntas do público" items={study.anatomy.audienceQuestions}/>
        </div>
        <div>
          <ListBlock title="Lacunas editoriais" items={study.anatomy.contentGaps}/>
          <ListBlock title="Notas de produção" items={study.anatomy.productionNotes}/>
        </div>
        <div>
          <ListBlock title="Topic Genome · entidades vencedoras" items={study.anatomy.topicGenome.winningEntities}/>
          <ListBlock title="Topic Genome · ângulos recorrentes" items={study.anatomy.topicGenome.recurringAngles}/>
        </div>
        <div>
          <ListBlock title="Mecanismos de curiosidade" items={study.anatomy.topicGenome.curiosityMechanisms}/>
          <ListBlock title="Tokens de títulos" items={study.anatomy.topicGenome.titleTokens}/>
        </div>
        <div>
          <ListBlock title="Contrastes dos vídeos fracos" items={study.anatomy.weakVideoContrasts}/>
          <ListBlock title="Diferenças do Topic Genome" items={study.anatomy.topicGenome.underperformingContrasts}/>
        </div>
        <div>
          <ListBlock title="Sequência editorial dos breakouts" items={study.anatomy.sequenceInsights}/>
          <ListBlock title="Sinais que sustentam repetibilidade" items={study.anatomy.sustainability.supportingSignals}/>
          <ListBlock title="Riscos de sustentabilidade" items={study.anatomy.sustainability.riskSignals}/>
        </div>
      </div>

      {study.weakRecentVideos.length>0&&<>
       <div className="section-heading"><div><h2>Contraste: long forms fracos na amostra <span className="count-pill">{study.weakRecentVideos.length}</span></h2><p>Menor desempenho dentro de até 100 uploads recentes inspecionados. Não é apresentado como “piores vídeos de toda a história” quando a coleta é parcial.</p></div></div>
       <div className="study-weak-grid">{study.weakRecentVideos.map(video=><a key={video.id} href={video.url} target="_blank" rel="noreferrer" className="study-weak-card"><img src={video.thumbnail} alt=""/><div><strong>{video.title}</strong><span>{compact(video.views)} views · {formatDuration(video.duration)}</span></div></a>)}</div>
      </>}

      <div className="study-anatomy-grid">
        <section className="panel study-summary">
          <div className="panel-heading"><Eye size={20}/><h2>Análise visual das thumbnails</h2></div>
          <p>{study.thumbnailAnalysis.inspected?'As imagens abaixo foram realmente inspecionadas pela camada de visão.':'A camada visual não foi concluída nesta execução.'}</p>
        </section>
        <div>
          <ListBlock title="Padrões visuais dos hits" items={study.thumbnailAnalysis.hitPatterns}/>
          <ListBlock title="Composição recorrente" items={study.thumbnailAnalysis.compositionPatterns}/>
        </div>
        <div>
          <ListBlock title="Diferenças hits × fracos" items={study.thumbnailAnalysis.visualContrasts}/>
          <ListBlock title="Padrões visuais dos fracos" items={study.thumbnailAnalysis.weakPatterns}/>
        </div>
        <div>
          <ListBlock title="Hooks visuais" items={study.thumbnailAnalysis.visualHooks}/>
          <ListBlock title="Texto nas thumbnails" items={study.thumbnailAnalysis.textUsage}/>
        </div>
        <div>
          <ListBlock title="Sujeitos e objetos recorrentes" items={study.thumbnailAnalysis.recurringSubjects}/>
          <ListBlock title="Consistência visual" items={study.thumbnailAnalysis.consistencySignals}/>
          <ListBlock title="Limites da visão" items={study.thumbnailAnalysis.limitations}/>
        </div>
      </div>

      <div className="study-anatomy-grid">
        <section className="panel study-summary">
          <div className="panel-heading"><MessageSquareText size={20}/><h2>Comment Demand Mining</h2></div>
          <p>Extraído somente da amostra pública de comentários coletada nos Top 10.</p>
        </section>
        <div>
          <ListBlock title="Pedidos de próximos temas" items={study.anatomy.commentDemand.requestedTopics}/>
          <ListBlock title="Perguntas repetidas" items={study.anatomy.commentDemand.repeatedQuestions}/>
        </div>
        <div>
          <ListBlock title="Pontos de confusão" items={study.anatomy.commentDemand.confusionPoints}/>
          <ListBlock title="Gatilhos emocionais expressos" items={study.anatomy.commentDemand.emotionalTriggers}/>
          <ListBlock title="Objeções e debates" items={study.anatomy.commentDemand.objectionsAndDebates}/>
        </div>
      </div>

      <div className="section-heading study-similar-heading"><div><h2>Pequenos do mesmo nicho <span className="count-pill">{study.similarCandidates.length}</span></h2><p>Somente US + inglês confirmado + long form + mesmos gates do Radar + aprovação semântica do Niche Lock.</p></div></div>
      <div className="channel-grid">
        {study.similarCandidates.map(match=><article className="channel-card study-match-card" key={match.channel.id}>
          <a className="channel-cover" href={match.channel.video.url} target="_blank" rel="noreferrer" style={{backgroundImage:`url("${match.channel.video.thumbnail}")`,backgroundSize:'cover'}}>
            <span className="cover-top"><span className="cover-badge"><Play size={11} fill="currentColor"/>LONG FORM</span><span className="cover-demo">{match.similarityScore}% NICHO</span></span>
            <span className="cover-bottom"><span>{match.channel.video.title}</span></span>
          </a>
          <div className="card-content">
            <div className="channel-name"><span className="avatar">{match.channel.name.slice(0,2).toUpperCase()}</span><div><h3>{match.channel.name}</h3><span>{match.channel.subscribers===null?'Inscritos ocultos':compact(match.channel.subscribers)+' inscritos'} · {match.channel.videoCount} vídeos</span></div></div>
            <div className="tags"><span className="tag green">US</span><span className="tag blue">English</span><span className="tag">{study.nicheProfile.subniche}</span></div>
            <p className="card-description">{match.similarityReason}</p>
            <div className="signal-row"><span><strong>{compact(match.channel.video.views)}</strong> views</span><span><Clock3 size={13}/>{ageHours(match.channel.video.publishedAt)}h</span></div>
            <div className="study-match-terms">{match.matchedTerms.map(term=><span key={term}>{term}</span>)}</div>
            <div className="card-footer"><span className="card-state analyzed"><span/>Passou todos os gates</span><a href={match.channel.url} target="_blank" rel="noreferrer">Canal <ExternalLink size={13}/></a></div>
          </div>
        </article>)}
      </div>
      {!study.similarCandidates.length&&<div className="info-strip"><Search size={18}/><span>Nenhum canal passou simultaneamente pelos filtros de mercado, tamanho, recência, breakout e aderência semântica ao mesmo nicho nesta rodada. Isso é preferível a preencher a tela com falsos similares.</span></div>}

      <section className="panel study-limitations">
        <div className="panel-heading"><BrainCircuit size={20}/><h2>Limites da evidência</h2></div>
        <ul>{study.anatomy.limitations.map((item,i)=><li key={i}>{item}</li>)}</ul>
        {study.scanTruncated&&<p>{study.topSampleScope==='recent-uploads'?'A busca global estava indisponível; o canal informa '+study.totalPublicVideos+' vídeos públicos e a análise usou somente os uploads recentes inspecionados.':'A seleção dos Top 10 usa busca ordenada por views entre vídeos long form; o canal informa '+study.totalPublicVideos+' vídeos públicos e a amostra consultada foi menor que esse total.'}</p>}
      </section>
    </>}
  </>;
}
