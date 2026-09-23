import test from 'node:test';
import assert from 'node:assert/strict';
import { channelBrainPayloadSchema } from '../src/lib/server/validation';

const now='2026-09-23T15:00:00.000Z';
const valid={
  kind:'channel-brain' as const,
  channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
  constitution:{
    premise:'Grug explica finanças com metáforas pré-históricas.',
    audience:'Público de língua inglesa interessado em finanças pessoais.',
    editorialPromise:'Explicar finanças sem jargão.',
    worldview:'Recursos, risco, tempo e liberdade traduzidos para o universo pré-histórico.',
    tone:['simples','pragmático'],
    languageRules:['Roteiros finais em inglês simples.'],
    humor:['Humor visual.'],
    universeRules:['Pedras podem representar dinheiro.'],
    forbidden:['Não transformar Grug em professor formal.'],
    metaphors:['pedras = dinheiro']
  },
  characters:[{
    id:'grug',
    name:'Grug',
    role:'Protagonista',
    traits:['curioso'],
    knows:['recursos são limitados'],
    doesNotKnow:['investing'],
    rules:['Aprende conceitos em sequência.']
  }],
  narrative:{
    currentArc:'Foundations of Money',
    stateSummary:'Primeiro episódio publicado; ingestão pendente.',
    establishedConcepts:[],
    partialConcepts:[],
    unknownConcepts:['investing'],
    openThreads:['Ingerir episódio 1.'],
    resolvedThreads:[],
    doNotRepeat:[],
    nextConcepts:[]
  },
  learnings:[],
  createdAt:now,
  updatedAt:now
};

test('Channel Brain accepts a structured persistent memory payload',()=>{
  const parsed=channelBrainPayloadSchema.parse(valid);
  assert.equal(parsed.channelId,valid.channelId);
  assert.equal(parsed.characters[0].name,'Grug');
  assert.deepEqual(parsed.constitution.metaphors,['pedras = dinheiro']);
});

test('Channel Brain rejects invalid managed channel identifiers',()=>{
  const result=channelBrainPayloadSchema.safeParse({...valid,channelId:'grug'});
  assert.equal(result.success,false);
});

test('Channel Brain keeps list growth bounded',()=>{
  const result=channelBrainPayloadSchema.safeParse({
    ...valid,
    constitution:{...valid.constitution,tone:Array.from({length:17},(_,i)=>`tone-${i}`)}
  });
  assert.equal(result.success,false);
});
