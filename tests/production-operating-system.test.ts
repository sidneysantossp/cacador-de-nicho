import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AI_FACTORY_BOOTSTRAP,
  PRODUCTION_OPERATING_SYSTEM_DOCUMENT,
  PRODUCTION_OPERATING_SYSTEM_ID,
  PRODUCTION_OPERATING_SYSTEM_VERSION,
  productionOperatingSystemRef
} from '../src/lib/production-operating-system';

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');

test('Factory Mode is a canonical global operating system',()=>{
  assert.equal(PRODUCTION_OPERATING_SYSTEM_ID,'factory-mode');
  assert.equal(PRODUCTION_OPERATING_SYSTEM_VERSION,'1.1.0');
  assert.equal(PRODUCTION_OPERATING_SYSTEM_DOCUMENT,'docs/PRODUCTION_OPERATING_SYSTEM.md');
  assert.deepEqual(productionOperatingSystemRef(),{
    id:'factory-mode',
    version:'1.1.0',
    document:'docs/PRODUCTION_OPERATING_SYSTEM.md',
    required:true
  });

  const doc=read(PRODUCTION_OPERATING_SYSTEM_DOCUMENT);
  assert.match(doc,/Production Operating System/);
  assert.match(doc,/batch-first and exception-driven/i);
  assert.match(doc,/ORIGINALITY \/ ANTI-SLOP GATE/);
  assert.match(doc,/5 finished videos\/day/);
  assert.match(doc,/12 finished videos\/day/);
  assert.match(AI_FACTORY_BOOTSTRAP,/active operator minutes per finished video/i);
});

test('Every repository AI entry path tells agents to load Factory Mode',()=>{
  const agents=read('AGENTS.md');
  const start=read('AI_START_HERE.md');
  assert.match(agents,/AI_START_HERE\.md/);
  assert.match(agents,/docs\/PRODUCTION_OPERATING_SYSTEM\.md/);
  assert.match(agents,/factory-mode@1\.1\.0/);
  assert.match(start,/docs\/PRODUCTION_OPERATING_SYSTEM\.md/);
  assert.match(start,/Channel Brain, Production DNA/);

  for(const path of [
    'CLAUDE.md',
    'GEMINI.md',
    '.github/copilot-instructions.md',
    '.cursor/rules/factory-mode.mdc'
  ]){
    const source=read(path);
    assert.match(source,/AI_START_HERE\.md/,path+' must point to the mandatory bootstrap');
    assert.match(source,/docs\/PRODUCTION_OPERATING_SYSTEM\.md/,path+' must point to the global production contract');
    assert.match(source,/factory-mode@1\.1\.0/,path+' must pin the current factory version');
  }
});

test('Every OpenAI runtime decision module injects the global Factory Mode bootstrap',()=>{
  const dir=resolve(process.cwd(),'src/lib/server');
  const files=readdirSync(dir).filter(name=>name.endsWith('.ts'));
  const decisionAiFiles=files.filter(name=>{
    const source=readFileSync(resolve(dir,name),'utf8');
    return source.includes('responses.parse({');
  });
  assert.ok(decisionAiFiles.length>=5);
  for(const name of decisionAiFiles){
    const source=readFileSync(resolve(dir,name),'utf8');
    assert.match(source,/withFactoryInstructions/,name+' must inject the global Factory Mode contract');
  }
});

test('New managed projects and Content Projects are stamped with the Factory Mode pointer',()=>{
  const actions=read('src/app/api/actions/route.ts');
  const contentOs=read('src/lib/server/content-os.ts');
  const validation=read('src/lib/server/validation.ts');
  const schema=read('docs/schema.sql');
  assert.match(actions,/productionSystem:productionOperatingSystemRef\(\)/);
  assert.match(contentOs,/productionSystem:productionOperatingSystemRef\(\)/);
  assert.match(validation,/productionOperatingSystemPointerSchema/);
  assert.match(validation,/originality:z\.object/);
  assert.match(schema,/attach_factory_mode_pointer/);
  assert.match(schema,/radar_managed_channels_factory_mode/);
  assert.match(schema,/radar_content_projects_factory_mode/);
});

test('Authenticated production-system endpoint exposes the AI bootstrap manifest',()=>{
  const route=read('src/app/api/production-system/route.ts');
  assert.match(route,/authenticated\(request\)/);
  assert.match(route,/AI_FACTORY_BOOTSTRAP/);
  assert.match(route,/AI_START_HERE\.md/);
  assert.match(route,/PRODUCTION_OPERATING_SYSTEM_DOCUMENT/);
});
