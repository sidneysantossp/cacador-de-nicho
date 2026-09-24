'use client';

import { useState } from 'react';
import { AlertCircle, ArrowUpRight, CheckCircle2, PlayCircle, Rocket, Sparkles } from 'lucide-react';
import type { Decision, ManagedChannel, MissionBrief, YouTubeSearchBudgetState } from '@/lib/types';

function statusLabel(status:MissionBrief['status']){
  return status==='completed'?'Missão concluída':status==='partial'?'Missão parcial':'Missão bloqueada';
}
function when(value:string){
  return new Date(value).toLocaleString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
}

export default function MissionControl({
  brief,
  mode,
  busy,
  onRun,
  onOpenStudy,
  onPilotDecision,
  onPilotHandoff,
  onOpenPilotHandoff,
  pilotDecisions,
  managedChannels,
  searchBudget
}:{
  brief?:MissionBrief|null;
  mode:'demo'|'live';
  busy:string;
  onRun:()=>Promise<boolean|undefined>;
  onOpenStudy:(channelStudyId:string)=>void;
  onPilotDecision:(gapId:string,decision:'approved'|'rejected')=>Promise<boolean|undefined>;
  onPilotHandoff:(decisionId:string,channelId:string)=>Promise<boolean|undefined>;
  onOpenPilotHandoff:(channelId:string)=>void;
  pilotDecisions:Decision[];
  managedChannels:ManagedChannel[];
  searchBudget?:YouTubeSearchBudgetState|null;
}){
  const universeOpportunities=brief?.universeOpportunities??[];
  const [pilotChannels,setPilotChannels]=useState<Record<string,string>>({});
  const pilotDecisionFor=(gapId:string)=>pilotDecisions.find(item=>item.kind==='universe-pilot'&&item.opportunityId===gapId);
  return <div className="mission-control">
    <section className="mission-hero">
      <div>
        <span className="eyebrow">MISSÃO / OBJETIVO EMPRESARIAL</span>
        <h2>Encontre o que merece <span>virar produção.</span></h2>
        <p>{brief?.objective??'Encontrar, validar e transformar oportunidades de conteúdo em ativos capazes de gerar receita.'}</p>
      </div>
      <button className="button primary mission-run" disabled={mode==='demo'||!!busy} onClick={()=>void onRun()}>
        <Rocket size={18}/>{busy==='mission'?'Executando missão…':'Executar missão agora'}
      </button>
    </section>

    {searchBudget&&<section className="youtube-budget">
      <div className="youtube-budget-main">
        <div>
          <span className="eyebrow">YOUTUBE SEARCH BUDGET · DIA DO PACÍFICO</span>
          <h3>{searchBudget.used}<small>/ {searchBudget.limit}</small> buscas usadas</h3>
          <p>{searchBudget.blocked?'Bucket marcado como indisponível nesta data. O sistema trabalha em modo quota-degraded.':`${searchBudget.remaining} buscas ainda disponíveis. O Radar não pode consumir a reserva destinada a investigação.`}</p>
        </div>
        <span className={`tag ${searchBudget.blocked?'orange':'green'}`}>{searchBudget.blocked?'SEARCH PAUSADO':`${searchBudget.remaining} RESTANTES`}</span>
      </div>
      <div className="youtube-budget-bar"><span style={{width:`${Math.min(100,(searchBudget.used/searchBudget.limit)*100)}%`}}/></div>
      <div className="youtube-budget-grid">
        {([
          ['Descoberta','radar-discovery'],
          ['Análise','channel-study'],
          ['Similares','similar-channels'],
          ['Resolver canal','channel-resolution'],
          ['Referências','reference-resolution']
        ] as const).map(([label,key])=><div key={key}><span>{label}</span><strong>{searchBudget.byPurpose[key]} / {searchBudget.purposeLimits[key]}</strong></div>)}
      </div>
      {searchBudget.duplicateSkips>0&&<p className="youtube-budget-note">{searchBudget.duplicateSkips} busca(s) redundante(s) foram evitadas nas janelas recentes.</p>}
    </section>}

    {!brief&&<section className="mission-empty">
      <Sparkles size={28}/>
      <h3>A primeira missão ainda não foi executada.</h3>
      <p>O sistema vai verificar integrações, fechar análises pendentes, atualizar o Radar e preparar somente o que chegar ao nível de decisão ou produção.</p>
    </section>}

    {brief&&<>
      <div className="mission-status-row">
        <span className={`mission-status ${brief.status}`}><CheckCircle2 size={15}/>{statusLabel(brief.status)}</span>
        <span>Última execução: {when(brief.completedAt)}</span>
        <span>{brief.market.qualifiedChannels} candidato(s) rígido(s) · {brief.market.channelStudies} análise(s) · {brief.market.opportunityReports} report(s)</span>
        {((brief.market.competitors??0)>0||(brief.market.universeQueuePending??0)>0)&&<span>Universe: {brief.market.competitors??0} concorrente(s) · {brief.market.competitorSignals??0} com sinal · {brief.market.competitorDna??0} com DNA · {brief.market.universeCurves??0} curva(s) · {brief.market.universeGaps??0} gap(s) · {brief.market.universeActionableGaps??universeOpportunities.length} acionável(is) · {brief.market.universeQueueCompleted??0} importados / {brief.market.universeQueuePending??0} pendentes</span>}
      </div>

      <section className="mission-priority">
        <div className="section-heading"><div><h2>Pronto para produzir <span className="count-pill">{brief.productionQueue.length}</span></h2><p>Somente oportunidades com validação estrutural e sinais mínimos de demanda, repetibilidade e lacuna aparecem aqui.</p></div></div>
        {brief.productionQueue.length?<div className="mission-production-grid">
          {brief.productionQueue.map((item,index)=><article className="mission-production-card" key={item.reportId}>
            <div className="opportunity-top"><span className="big-number">{String(index+1).padStart(2,'0')}</span><span className="tag green">PRODUCTION READY</span></div>
            <span className="mission-source">Origem: {item.sourceChannel}</span>
            <h3>{item.conceptName}</h3>
            <p>{item.title}</p>
            <div className="mission-first-episode"><span>COMEÇAR POR</span><strong>{item.firstEpisode||'Definir episódio piloto'}</strong></div>
            <ul>{item.reasons.slice(0,4).map(reason=><li key={reason}>{reason}</li>)}</ul>
            <div className="mission-next"><span>PRÓXIMO MOVIMENTO</span><p>{item.nextAction}</p></div>
            <button className="button primary small" onClick={()=>onOpenStudy(item.channelStudyId)}>Abrir plano completo <ArrowUpRight size={15}/></button>
          </article>)}
        </div>:<div className="mission-zero"><PlayCircle size={24}/><div><strong>Nenhuma oportunidade atingiu o nível de produção nesta missão.</strong><p>Os critérios não foram relaxados para preencher a fila.</p></div></div>}
      </section>


      {universeOpportunities.length>0&&<section className="mission-priority">
        <div className="section-heading"><div><h2>Oportunidades do Universe <span className="count-pill">{universeOpportunities.length}</span></h2><p>Gaps sustentados por curvas estruturais. “Pilot Ready” significa evidência suficiente para um teste controlado, não aprovação automática para produção em escala.</p></div></div>
        <div className="mission-production-grid">
          {universeOpportunities.map((item,index)=><article className="mission-production-card" key={item.gapId}>
            <div className="opportunity-top"><span className="big-number">{String(index+1).padStart(2,'0')}</span><span className={`tag ${item.readiness==='pilot-ready'?'green':'blue'}`}>{item.readiness==='pilot-ready'?'PILOT READY':'INVESTIGAR'}</span></div>
            <span className="mission-source">Curva: {item.curveName} · {item.independentCreators} criadores</span>
            <h3>{item.title}</h3>
            <p>Target: {item.targetSpace}</p>
            <div className="mission-first-episode"><span>PRIMEIRO TESTE</span><strong>{item.firstTest}</strong></div>
            {item.alternateAngles?.length?<div className="mission-next"><span>ÂNGULOS RELACIONADOS ({item.alternateAngles.length})</span><p>{item.alternateAngles.map(angle=>`${angle.title} — ${angle.curveName}`).join(' · ')}</p></div>:null}
            <ul>{item.reasons.slice(0,4).map(reason=><li key={reason}>{reason}</li>)}</ul>
            {item.risks.length>0&&<div className="mission-next"><span>RISCOS</span><p>{item.risks.slice(0,3).join(' · ')}</p></div>}
            {item.readiness==='pilot-ready'&&<div className="mission-next">
              <span>DECISÃO DO PILOTO</span>
              {pilotDecisionFor(item.gapId)?<p><strong>{pilotDecisionFor(item.gapId)?.decision==='approved'?'PILOTO APROVADO':'PILOTO REJEITADO'}</strong> · {pilotDecisionFor(item.gapId)?.reason}</p>:<p>A evidência passou pelo gate. A decisão final continua humana.</p>}
              {pilotDecisionFor(item.gapId)?.pilotBrief&&<div className="mission-first-episode">
                <span>PILOT BRIEF · PRÓXIMO GATE</span>
                <strong>{pilotDecisionFor(item.gapId)?.pilotBrief?.firstTest}</strong>
                <p>{pilotDecisionFor(item.gapId)?.pilotBrief?.hypothesis}</p>
                <small>{pilotDecisionFor(item.gapId)?.pilotBrief?.testPlan.successGate.slice(0,2).join(' · ')}</small>
              </div>}
              {pilotDecisionFor(item.gapId)?.decision==='approved'&&pilotDecisionFor(item.gapId)?.pilotBrief&&!pilotDecisionFor(item.gapId)?.pilotHandoff&&<div className="mission-first-episode">
                <span>ENVIAR PARA CONTENT OS</span>
                <select value={pilotChannels[item.gapId]??''} onChange={event=>setPilotChannels(prev=>({...prev,[item.gapId]:event.target.value}))}>
                  <option value="">Escolha explicitamente o canal próprio…</option>
                  {managedChannels.map(channel=><option value={channel.id} key={channel.id}>{channel.name} · {channel.niche}</option>)}
                </select>
                <small>O handoff cria apenas um draft com fact-check pendente. Roteiro e produção continuam bloqueados até revisão humana.</small>
                <button className="button primary small" disabled={mode==='demo'||!!busy||!(pilotChannels[item.gapId]??'')} onClick={()=>{
                  const decision=pilotDecisionFor(item.gapId);
                  const channelId=pilotChannels[item.gapId]??'';
                  if(decision&&channelId)void onPilotHandoff(decision.id,channelId);
                }}>Criar draft no Content OS</button>
              </div>}
              {pilotDecisionFor(item.gapId)?.pilotHandoff&&<div className="mission-first-episode">
                <span>CONTENT OS · HANDOFF CONCLUÍDO</span>
                <strong>{pilotDecisionFor(item.gapId)?.pilotHandoff?.channelName}</strong>
                <p>Episódio e Content Project foram criados em draft. Pesquisa, fact-check e aprovação ainda são obrigatórios.</p>
                <button className="button subtle small" onClick={()=>onOpenPilotHandoff(pilotDecisionFor(item.gapId)!.pilotHandoff!.channelId)}>Abrir Content OS <ArrowUpRight size={15}/></button>
              </div>}
              <div className="mission-actions">
                <button className="button primary small" disabled={mode==='demo'||!!busy||pilotDecisionFor(item.gapId)?.decision==='approved'} onClick={()=>void onPilotDecision(item.gapId,'approved')}>Aprovar piloto</button>
                <button className="button subtle small" disabled={mode==='demo'||!!busy||pilotDecisionFor(item.gapId)?.decision==='rejected'} onClick={()=>void onPilotDecision(item.gapId,'rejected')}>Não seguir</button>
              </div>
            </div>}
          </article>)}
        </div>
      </section>}

      {brief.decisionsNeeded.length>0&&<section className="mission-decisions">
        <div className="section-heading"><div><h2>Requer sua decisão <span className="count-pill">{brief.decisionsNeeded.length}</span></h2><p>O sistema chegou ao limite do que deve decidir sozinho.</p></div></div>
        <div className="mission-decision-list">{brief.decisionsNeeded.map((item,index)=><article key={`${item.title}-${index}`}>
          <span className="tag orange">{item.type==='pilot-decision'?'DECIDIR PILOTO':'REVISAR EVIDÊNCIA'}</span>
          <h3>{item.title}</h3>
          <p>{item.reason}</p>
        </article>)}</div>
      </section>}

      {(brief.blockers.length>0||brief.health.blockers.length>0)&&<section className="mission-blockers">
        <div className="section-heading"><div><h2>Bloqueios que impedem avanço</h2><p>Somente problemas que reduziram a capacidade da missão aparecem aqui.</p></div></div>
        {[...brief.health.blockers,...brief.blockers].map((item,index)=><div className="info-strip" key={index}><AlertCircle size={18}/><span>{item}</span></div>)}
      </section>}
    </>}
  </div>;
}
