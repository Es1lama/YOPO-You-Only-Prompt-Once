import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { providerFile, savedProvider, verifyAndSaveProvider } from '../src/provider.js';
import { promptConnection, resolveService } from '../src/setup-provider.js';
import { reviewClient } from '../src/gemini.js';

test('service is identified from the key issuer or an exact API URL',()=>{
  for (const [input,format,base] of [
    ['1','gemini','https://generativelanguage.googleapis.com/v1beta/'],
    ['GPT','responses','https://api.openai.com/v1/'],
    ['deepseek','openai','https://api.deepseek.com/'],
    ['Claude','anthropic','https://api.anthropic.com/v1/'],
    ['https://example.invalid/path/v1','openai','https://example.invalid/path/v1/'],
    ['https://example.invalid/path/v1/chat/completions/','openai','https://example.invalid/path/v1/'],
    ['https://example.invalid/path/responses','responses','https://example.invalid/path/'],
    ['https://example.invalid/messages','anthropic','https://example.invalid/'],
    ['https://example.invalid/v1beta','gemini','https://example.invalid/v1beta/'],
    ['https://generativelanguage.googleapis.com/v1beta/openai','openai','https://generativelanguage.googleapis.com/v1beta/openai/']
  ]) assert.deepEqual(resolveService(input),{format,base});
  assert.deepEqual(resolveService('https://example.invalid/g/models/gemini-fixture:generateContent'),
    {base:'https://example.invalid/g/',format:'gemini',model:'gemini-fixture'});
  for (const bad of ['123','http://example.invalid/v1','https://example.invalid/?key=test','https://user:pw@example.invalid/']) {
    assert.throws(()=>resolveService(bad));
  }
});

test('each advertised provider reaches its expected review URL using both its number and its name',async()=>{
  const expected=[
    ['google', 'gemini', 'https://generativelanguage.googleapis.com/v1beta/'],
    ['openai', 'responses', 'https://api.openai.com/v1/'],
    ['deepseek', 'openai', 'https://api.deepseek.com/'],
    ['anthropic', 'anthropic', 'https://api.anthropic.com/v1/'],
    ['阿里', 'openai', 'https://dashscope.aliyuncs.com/compatible-mode/v1/'],
    ['月之暗面', 'openai', 'https://api.moonshot.cn/v1/'],
    ['智谱', 'openai', 'https://open.bigmodel.cn/api/paas/v4/'],
    ['火山', 'openai', 'https://ark.cn-beijing.volces.com/api/v3/'],
    ['腾讯', 'openai', 'https://tokenhub.tencentmaas.com/v1/'],
    ['百度', 'openai', 'https://qianfan.baidubce.com/v2/'],
    ['minimax', 'anthropic', 'https://api.minimax.cn/anthropic/v1/'],
    ['硅基', 'openai', 'https://api.siliconflow.cn/v1/'],
    ['讯飞', 'openai', 'https://spark-api-open.xf-yun.com/v1/'],
    ['阶跃', 'openai', 'https://api.stepfun.com/v1/'],
    ['小米', 'openai', 'https://api.xiaomimimo.com/v1/'],
    ['xai', 'openai', 'https://api.x.ai/v1/'],
    ['mistral', 'openai', 'https://api.mistral.ai/openai/v1/'],
    ['cohere', 'openai', 'https://api.cohere.ai/compatibility/v1/'],
    ['perplexity', 'responses', 'https://api.perplexity.ai/v1/'],
    ['openrouter', 'openai', 'https://openrouter.ai/api/v1/'],
    ['groq', 'openai', 'https://api.groq.com/openai/v1/'],
    ['together', 'openai', 'https://api.together.ai/v1/'],
    ['fireworks', 'openai', 'https://api.fireworks.ai/inference/v1/'],
    ['hugging face', 'openai', 'https://router.huggingface.co/v1/'],
    ['nvidia', 'openai', 'https://integrate.api.nvidia.com/v1/'],
    ['cerebras', 'openai', 'https://api.cerebras.ai/v1/'],
    ['azure', 'responses', 'https://demo.openai.azure.com/openai/v1/'],
    ['aws', 'openai', 'https://bedrock-runtime.eu-west-1.amazonaws.com/openai/v1/'],
    ['vertex', 'gemini', 'https://aiplatform.googleapis.com/v1/publishers/google/']
  ];
  const mockText=JSON.stringify({prompt:'ready'});
  for (const [index,[name,format,base]] of expected.entries()) {
    const detail = name==='azure'?'demo':name==='aws'?'eu-west-1':'1';
    const chosen=resolveService(String(index+1), detail);
    assert.deepEqual(chosen,{base,format},name);
    assert.deepEqual(resolveService(name, detail),chosen,name);
    const routes={openai:'chat/completions',responses:'responses',anthropic:'messages',gemini:'models/fixture:generateContent'};
    const replies={
      openai:{choices:[{finish_reason:'stop',message:{content:mockText}}]},
      responses:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:mockText}]}]},
      anthropic:{stop_reason:'end_turn',content:[{type:'text',text:mockText}]},
      gemini:{candidates:[{finishReason:'STOP',content:{parts:[{text:mockText}]}}]}
    };
    const review=reviewClient({...chosen,model:'fixture',key:'test-key'},async(url,opts)=>{
      assert.equal(url.href,base+routes[format],name);
      const headers=opts.headers;
      assert.equal(headers['x-api-key'] ?? headers['x-goog-api-key'] ?? headers.Authorization?.replace(/^Bearer /,''),'test-key',name);
      assert.equal(opts.redirect,'error');
      return Response.json(replies[format]);
    });
    assert.deepEqual(await review('brief','rules',{}),{prompt:'ready'},name);
  }
});

test('site, cloud resource and custom selections are resolved before asking for a hidden key',async()=>{
  const cases=[
    [['千问','2'],'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/'],
    [['百炼','5'],'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/'],
    [['Kimi','9','2'],'https://api.moonshot.ai/v1/'],
    [['智谱','2'],'https://api.z.ai/api/paas/v4/'],
    [['海螺','2'],'https://api.minimax.io/anthropic/v1/'],
    [['Azure','https://demo.services.ai.azure.com/'],'https://demo.services.ai.azure.com/openai/v1/'],
    [['aws','invalid.example','us-west-2'],'https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1/'],
    [['0','https://custom.example/v1/chat/completions'],'https://custom.example/v1/']
  ];
  for (const [steps,base] of cases) {
    const answers=[...steps,'test-key','model'],output=[];
    const cfg=await promptConnection(async (_prompt,secret)=>{
      assert.ok(answers.length);
      const answer=answers.shift();
      if (answer==='test-key') { assert.equal(secret,true); assert.ok(output.at(-1).includes(base)); }
      return answer;
    },s=>output.push(s));
    assert.equal(cfg.base,base);
    assert.doesNotMatch(output.join('\n'),/test-key/);
  }
  assert.throws(()=>resolveService('Azure','https://demo.openai.azure.com.invalid'));
  assert.throws(()=>resolveService('AWS','us-east-1.example.com'));
  const answers=['Kimi',''];
  assert.equal(await promptConnection(async()=>answers.shift(),()=>{}),undefined);
});

test('long model lists can be paged, searched and selected without changing the platform model ID',async()=>{
  const answers=['OpenRouter','test-key','','n','/unknown','/qwen','2'];
  const options=Array.from({length:40},(_,i)=>'vendor/model-'+i).concat(['vendor/qwen-small','vendor/qwen-large']);
  const out=[];
  const cfg=await promptConnection(async()=>{ assert.ok(answers.length); return answers.shift(); },s=>out.push(s),async()=>options);
  assert.equal(cfg.model,'vendor/qwen-large');
  assert.ok(out.some(s=>s.startsWith('17. vendor/model-16')));
  assert.ok(out.some(s=>s.includes('没有匹配的模型')));
});

test('first-time user can paste their third-party URL, enter a hidden key and select a non-Google model',async()=>{
  const values=['https://example.invalid/path/v1/chat/completions','test-secret','','2'];
  const output=[], hidden=[];
  const config=await promptConnection(async (prompt,secret)=>{hidden.push(!!secret);return values.shift();},s=>output.push(s),
    async cfg=>{assert.equal(cfg.key,'test-secret'); return ['one','vendor/qwen'];});
  assert.deepEqual(config,{base:'https://example.invalid/path/v1/',format:'openai',key:'test-secret',model:'vendor/qwen'});
  assert.deepEqual(hidden,[false,true,false,false]);
  assert.ok(output.some(s=>s.includes('已收到输入')));
  assert.doesNotMatch(output.join('\n'),/test-secret/);
});

test('captured terminal output exits before soliciting or saving a credential',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'yo-po-captured-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const bin=fileURLToPath(new URL('../bin/yo-po.js',import.meta.url));
  const child=spawnSync(process.execPath,[bin,'configure-api'],{
    env:{...process.env,HOME:home,USERPROFILE:home,CODEX_HOME:path.join(home,'.codex')},
    input:'fixture-private-input\n',encoding:'utf8',timeout:10000,windowsHide:true
  });
  assert.equal(child.status,1);
  assert.match(child.stderr,/无法安全输入密钥/);
  assert.doesNotMatch(child.stdout+child.stderr,/【密钥输入】|fixture-private-input/);
  assert.equal(fs.existsSync(path.join(home,'.yo-po','provider.json')),false);
});

test('model name can be entered even when the provider has no model list',async()=>{
  const values=['deepseek','test-key','','custom-model'];
  const config=await promptConnection(async()=>values.shift(),()=>{},async()=>{throw Error('404');});
  assert.equal(config.model,'custom-model');assert.equal(config.format,'openai');
});

test('closing the setup window during verification leaves the stored connection alone',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yo-po-close-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const stop=new AbortController();
  const config={format:'openai',base:'https://example.invalid/v1/',key:'fixture',model:'fixture'};
  const request=async(_url,opts)=>{
    stop.abort();
    assert.ok(opts.signal.aborted);
    return Response.json({choices:[{finish_reason:'stop',message:{content:'{"prompt":"ok"}'}}]});
  };
  await assert.rejects(verifyAndSaveProvider(dir,config,request,stop.signal),{name:'AbortError'});
  assert.equal(fs.existsSync(providerFile(dir)),false);
});

test('switching providers replaces the saved connection only after the new model passes',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yo-po-switch-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cfg={format:'openai',base:'https://example.invalid/v1/',key:'local-fixture',model:'first'};
  const valid=()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"prompt":"ready"}'}}]});
  await verifyAndSaveProvider(dir,cfg,valid);
  const before=fs.readFileSync(providerFile(dir));
  await assert.rejects(verifyAndSaveProvider(dir,{...cfg,model:'unavailable'},()=>new Response('',{status:404})),/404/);
  assert.deepEqual(fs.readFileSync(providerFile(dir)),before);
  await verifyAndSaveProvider(dir,{...cfg,format:'anthropic',model:'new-model'},()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:'{"prompt":"ready"}'}]}));
  assert.deepEqual(savedProvider(dir),{base:cfg.base,format:'anthropic',model:'new-model'});
});

for (const format of ['anthropic','responses']) {
  test(format+' sends the configured model and reads only completed text replies',async()=>{
    const cfg={format,key:'test-key',model:'arbitrary-model',base:'https://example.invalid/path/v1/'};
    const result = await reviewClient(cfg,async (url,opts)=>{
      const body=JSON.parse(opts.body);
      assert.equal(body.model,cfg.model);
      assert.equal(opts.redirect,'error');
      const content='{"prompt":"complete"}';
      if (format==='anthropic') {
        assert.equal(url.pathname,'/path/v1/messages');assert.equal(opts.headers['x-api-key'],cfg.key);
        assert.equal(opts.headers['anthropic-version'],'2023-06-01');
        assert.equal(JSON.parse(body.messages[0].content).goal,'actual task');
        return Response.json({stop_reason:'end_turn',content:[{type:'thinking',thinking:'ignored'},{type:'text',text:content}]});
      }
      assert.equal(url.pathname,'/path/v1/responses');assert.equal(opts.headers.Authorization,'Bearer test-key');
      assert.equal(body.store,false);assert.equal(JSON.parse(body.input[0].content).goal,'actual task');
      return Response.json({status:'completed',output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:content}]}]});
    })('brief','rules',{goal:'actual task'});
    assert.equal(result.prompt,'complete');
    await assert.rejects(reviewClient(cfg,()=>Response.json({status:'incomplete',stop_reason:'max_tokens'}))('brief','',{}),/Incomplete/);
  });
}
