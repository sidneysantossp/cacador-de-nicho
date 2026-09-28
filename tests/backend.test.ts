import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { agentAuthenticated, agentOperatorConfigured, authConfigured, createSession, validSession, sameOrigin, requireOperator, sessionCookie } from '../src/lib/server/auth';
import { observedWithinWindow, settingsSchema } from '../src/lib/server/validation';
const now=Date.parse('2026-09-22T12:00:00Z');
test('missing secrets fail closed, signed sessions expire and reject tampering',()=>{process.env.APP_PASSWORD='';process.env.SESSION_SECRET='';assert.equal(authConfigured(),false);assert.equal(validSession('anything'),false);process.env.APP_PASSWORD='a'.repeat(24);process.env.SESSION_SECRET='b'.repeat(40);const session=createSession(now);assert.equal(validSession(session,now),true);assert.equal(validSession(session+'x',now),false);assert.equal(validSession(session,now+12*3600000),false);process.env.SESSION_SECRET='c'.repeat(40);assert.equal(validSession(session,now),false);delete process.env.APP_PASSWORD;delete process.env.SESSION_SECRET;});
test('session cookie survives top-level OAuth callback navigation without weakening cross-site writes',()=>{const cookie=sessionCookie('signed-session');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.doesNotMatch(cookie,/SameSite=Strict/);assert.equal(sessionCookie('',0).includes('Max-Age=0'),true);});
test('writes require an authenticated session and exact origin',()=>{assert.equal(sameOrigin(new Request('https://radar.test/api/actions',{headers:{origin:'https://evil.test'}})),false);assert.throws(()=>requireOperator(new Request('https://radar.test/api/actions',{headers:{origin:'https://radar.test'}})),/senha/);assert.equal(sameOrigin(new Request('https://radar.test/api/actions')),false);});
test('same-origin validation accepts HTTPS reverse proxy origin and rejects spoofed origins',()=>{const headers={origin:'https://radar.test',host:'radar.test','x-forwarded-proto':'https'};assert.equal(sameOrigin(new Request('http://127.0.0.1:3000/api/auth',{headers})),true);assert.equal(sameOrigin(new Request('http://127.0.0.1:3000/api/auth',{headers:{...headers,origin:'https://evil.test'}})),false);assert.equal(sameOrigin(new Request('http://127.0.0.1:3000/api/auth',{headers:{origin:'https://radar.test',host:'radar.test','x-forwarded-proto':'javascript'}})),false);});
test('agent operator uses a separate scoped server secret without browser session or origin',()=>{
  const previous=process.env.AGENT_OPERATOR_SECRET;
  process.env.AGENT_OPERATOR_SECRET='agent-'.padEnd(48,'x');
  assert.equal(agentOperatorConfigured(),true);
  const allowed=new Request('http://127.0.0.1:3000/api/episode-automation',{
    method:'POST',
    headers:{'x-cacadores-agent-secret':process.env.AGENT_OPERATOR_SECRET}
  });
  assert.equal(agentAuthenticated(allowed),true);
  assert.doesNotThrow(()=>requireOperator(allowed));
  const wrong=new Request('http://127.0.0.1:3000/api/episode-automation',{
    method:'POST',
    headers:{'x-cacadores-agent-secret':'wrong-secret'.padEnd(48,'x')}
  });
  assert.equal(agentAuthenticated(wrong),false);
  assert.throws(()=>requireOperator(wrong),/Origem/);
  const sensitive=new Request('http://127.0.0.1:3000/api/provider-settings',{
    method:'POST',
    headers:{'x-cacadores-agent-secret':process.env.AGENT_OPERATOR_SECRET}
  });
  assert.equal(agentAuthenticated(sensitive),false);
  assert.throws(()=>requireOperator(sensitive),/Origem/);
  if(previous===undefined)delete process.env.AGENT_OPERATOR_SECRET;
  else process.env.AGENT_OPERATOR_SECRET=previous;
});
test('viral window uses observation time, excluding exact 72h boundary and future publication',()=>{assert.equal(observedWithinWindow('2026-09-19T12:00:01Z','2026-09-22T12:00:00Z',500000,500000,72),true);assert.equal(observedWithinWindow('2026-09-19T12:00:00Z','2026-09-22T12:00:00Z',500000,500000,72),false);assert.equal(observedWithinWindow('2026-09-23T12:00:00Z','2026-09-22T12:00:00Z',500000,500000,72),false);assert.equal(observedWithinWindow('bad','bad',500000,500000,72),false);});
test('settings enforce bounded API, models and analysis budgets',()=>{const settings={queries:['finance'],languages:['en'],minViews:500000,maxVideoAgeHours:72,maxChannelVideos:20,maxChannelAgeDays:180,enabled:false,autoAnalyze:false,maxAnalysesPerRun:6,analysisModel:'gpt-5.6-terra',scriptModel:'gpt-5.6-sol'};assert.equal(settingsSchema.safeParse(settings).success,true);assert.equal(settingsSchema.safeParse({...settings,maxAnalysesPerRun:12}).success,true);assert.equal(settingsSchema.safeParse({...settings,maxAnalysesPerRun:13}).success,false);assert.equal(settingsSchema.safeParse({...settings,queries:Array(6).fill('finance')}).success,false);assert.equal(settingsSchema.safeParse({...settings,minViews:-1}).success,false);assert.equal(settingsSchema.safeParse({...settings,analysisModel:'unknown-model'}).success,false);});

test('self-hosted agent client keeps the credential server-side and limits routes',()=>{
  const source=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-agent-api'),'utf8');
  assert.match(source,/AGENT_OPERATOR_SECRET/);
  assert.match(source,/x-cacadores-agent-secret/);
  assert.match(source,/127\.0\.0\.1/);
  assert.match(source,/\/api\/episode-automation/);
  assert.doesNotMatch(source,/\/api\/provider-settings/);
  assert.doesNotMatch(source,/\/api\/autopilot-control/);
  assert.doesNotMatch(source,/echo[^\n]*\\$\\{?AGENT_OPERATOR_SECRET/);
});

test('ElevenLabs replacement key UI and validation use the same minimum and real TTS capability',()=>{
  const ui=readFileSync(resolve(process.cwd(),'src/components/provider-settings.tsx'),'utf8');
  const providers=readFileSync(resolve(process.cwd(),'src/lib/server/providers.ts'),'utf8');
  assert.match(ui,/provider="elevenlabs"[\s\S]*minLength=\{8\}/);
  assert.match(ui,/Text to Speech: Access \+ Voices: Read/);
  assert.match(providers,/\/v2\/voices\?page_size=1/);
  assert.match(providers,/\/v1\/text-to-speech\//);
  assert.match(providers,/missing_permissions/);
  assert.match(providers,/payment_issue/);
});

test('ElevenLabs key validation surfaces safe voice-list diagnostics',()=>{
  const providers=readFileSync(resolve(process.cwd(),'src/lib/server/providers.ts'),'utf8');
  assert.match(providers,/page_size=10/);
  assert.match(providers,/não conseguiu listar as vozes/);
  assert.match(providers,/HTTP '\+response\.status/);
  assert.match(providers,/missing_permissions/);
  assert.match(providers,/invalid_api_key/);
});

