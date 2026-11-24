import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { handle } from '../src/native.js';
import { gemini } from '../src/gemini.js';
import { install, eventNames } from '../src/install-hooks.js';
import { storeProvider, reviewer } from '../src/provider.js';

const event=(kind,id='chat-A',turn='t1',args={})=>({hook_event_name:kind,session_id:id,turn_id:turn,...args});
function temp(t) {
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'yo-po-native-'));
  t.after(()=>fs.rmSync(d,{recursive:true,force:true})); return d;
}
const plan={tasks:[{title:'first',acceptance:'verify first'},{title:'second',acceptance:'verify second'}],prompt:'Fully implement the first item.'};
const pass=id=>({verdict:'pass',reason:'supported by recorded evidence',evidence:[id],gaps:[],nextPrompt:''});
const gap={verdict:'revise',reason:'two gaps',evidence:[],gaps:['missing check','missing fix'],nextPrompt:'Fix both and rerun.'};

test('any human task automatically uses its own session, revises in that same conversation, then advances',async t=>{
  const home=temp(t),calls=[];
  async function ask(kind,_sys,p) {
    calls.push([kind,p]);
    if(kind==='dispatch') return plan;
    if(kind==='brief') return {prompt:'Verify the second item.'};
    const tool=p.evidence.findLast(x=>x.type==='toolStatus');
    assert.ok(tool);
    assert.doesNotMatch(tool.detail,/private-data|private-token/);
    return calls.filter(x=>x[0]==='review').length===1?gap:pass(tool.id);
  }
  const send=(kind,args,turn='t1',id='chat-A')=>handle(event(kind,id,turn,args),{home,ask});
  await send('UserPromptSubmit',{prompt:'Implement a first and a second check.'});
  await send('PostToolUse',{tool_name:'Bash',tool_use_id:'tool1',tool_input:{command:'npm test private-token'},tool_response:{exit_code:0,output:'private-data 7 passed'}});
  const r=await send('Stop',{last_assistant_message:'First claim.'});
  assert.equal(r.decision,'block'); assert.match(r.reason,/missing fix/); assert.match(r.reason,/missing check/);
  await send('UserPromptSubmit',{prompt:r.reason},'t2');
  const next=await send('Stop',{last_assistant_message:'Repaired.'},'t2');
  assert.match(next.reason,/Verify the second item/);
  await send('UserPromptSubmit',{prompt:next.reason},'t3');
  await send('PostToolUse',{tool_name:'Bash',tool_use_id:'tool2',tool_response:{exit_code:0}},'t3');
  const final=await send('Stop',{last_assistant_message:'Both completed.'},'t3');
  assert.match(final.systemMessage,/通过/);
  assert.equal(calls.at(-1)[1].finalGoalCheck,true);
  assert.equal(calls.filter(c=>c[0]==='dispatch').length,1);
  await send('UserPromptSubmit',{prompt:'An unrelated goal.'},'n1','chat-B');
  assert.equal(calls.at(-1)[1].originalGoal,'An unrelated goal.');
  assert.deepEqual(calls.at(-1)[1].priorReviews,[]);
});

test('private turns, follow-ups and session-wide pause never contact the reviewer or read transcripts',async t=>{
  const home=temp(t); let calls=0;
  const ask=async()=>{ calls++; return plan; };
  const send=(kind,turn,body)=>handle(event(kind,'B',turn,{ transcript_path:'dummy-should-never-open',...body }),{home,ask});
  for(const [i,p] of ['闭卷回答','再试一次','不用外部模型回答','no internet please','不用 Claude 审查这题','不要发给 Kimi','do not use OpenRouter','这个会话不要联网','普通问题'].entries()){
    await send('UserPromptSubmit',String(i),{prompt:p});
    await send('PostToolUse',String(i),{tool_name:'Bash',tool_response:'private'});
    assert.deepEqual(await send('Stop',String(i),{last_assistant_message:'private'}),{});
  }
  assert.equal(calls,0);
  await send('UserPromptSubmit','7',{prompt:'Yo-po on'});
  await send('UserPromptSubmit','8',{prompt:'Review this public task.'});
  assert.equal(calls,1);
});

test('a newer private instruction cancels an outstanding review result',async t=>{
  const home=temp(t); let release,started;
  const waiting=new Promise(r=>{started=r;});
  const ask=async kind=>{ if(kind==='dispatch')return plan; started(); return await new Promise(r=>{release=r;}); };
  await handle(event('UserPromptSubmit','A','t1',{prompt:'public goal'}),{home,ask});
  const pending=handle(event('Stop','A','t1',{last_assistant_message:'result'}),{home,ask});
  await waiting;
  await handle(event('UserPromptSubmit','A','t2',{prompt:'闭卷回答'}),{home,ask});
  release(gap); assert.deepEqual(await pending,{});
});

test('failed or malformed review is explicitly unverified',async t=>{
  const home=temp(t);
  const ask=async kind=>kind==='dispatch'?plan:pass('invented-id');
  await handle(event('UserPromptSubmit','C','1',{prompt:'Build it'}),{home,ask});
  const out=await handle(event('Stop','C','1',{last_assistant_message:'done'}),{home,ask});
  assert.match(out.systemMessage,/尚未通过审查/);
});

test('an action cannot pass solely on an assistant claim even when the API reviewer agrees',async t=>{
  const home=temp(t);
  const ask=async(kind,_rules,data)=>kind==='dispatch'?plan:pass(data.evidence.at(-1).id);
  await handle(event('UserPromptSubmit','code','t1',{prompt:'Create the output and verify it.'}),{home,ask});
  const out=await handle(event('Stop','code','t1',{last_assistant_message:'It exists, trust me.'}),{home,ask});
  assert.equal(out.decision,'block');
  assert.match(out.reason,/成功的工具结果/);
});

test('long tasks automatically reach review without an activation prefix',async t=>{
  const home=temp(t), prompt='Implement all of the following. '+ 'Item abc. '.repeat(2000);
  let received;
  await handle(event('UserPromptSubmit','long','t1',{prompt}),{home,ask:async(_k,_s,p)=>{received=p.originalGoal;return plan;}});
  assert.equal(received,prompt.trim());
});

test('installation targets each user, survives source relocation and preserves unrelated hook definitions on reinstall/removal',t=>{
  const dir=temp(t);
  for (const user of ['alice','bob']) {
    const home=path.join(dir,user,'data'),codex=path.join(dir,user,'codex');
    fs.mkdirSync(codex,{recursive:true});
    const original={extra:'keep',hooks:{Stop:[{matcher:'abc',hooks:[{type:'command',command:'other program'}]}]}};
    fs.writeFileSync(path.join(codex,'hooks.json'),JSON.stringify(original));
    const first=install({home,codex});
    assert.ok(first.changed);
    assert.equal(install({home,codex}).changed,false);
    const config=JSON.parse(fs.readFileSync(first.file));
    for (const n of eventNames) assert.ok(config.hooks[n].at(-1).hooks[0].command.includes(user));
    assert.deepEqual(config.hooks.Stop[0],original.hooks.Stop[0]);
    const later={hooks:[{type:'command',command:'installed after Yo-po'}]};
    config.hooks.Stop.push(later);
    fs.writeFileSync(first.file,JSON.stringify(config));
    assert.equal(install({home,codex}).changed,false);
    assert.deepEqual(JSON.parse(fs.readFileSync(first.file)),config);
    original.hooks.Stop.push(later);
    install({home,codex,remove:true});
    assert.deepEqual(JSON.parse(fs.readFileSync(first.file)),original);
  }
});

test('OpenAI-compatible transport accepts a provider model ID and uses bearer authentication',async()=>{
  const env={YOPO_API_FORMAT:'openai',YOPO_BASE_URL:'https://example.invalid/v1',YOPO_MODEL:'provider/qwen',YOPO_API_KEY:'fixture'};
  const result=await gemini(env,async(url,opt)=>{
    assert.equal(url.href,'https://example.invalid/v1/chat/completions');
    assert.equal(opt.headers.Authorization,'Bearer fixture');
    const body=JSON.parse(opt.body); assert.equal(body.model,'provider/qwen'); assert.equal(body.messages[0].role,'system');
    return Response.json({choices:[{finish_reason:'stop',message:{content:'{"prompt":"full"}'}}]});
  })('brief','rules',{originalGoal:'hello'}); assert.equal(result.prompt,'full');
});

test('installed command hook reads stdin and uses the configured compatible API across processes',async t=>{
  const dir=temp(t),home=path.join(dir,'.yo-po');
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const buf of req)body+=buf;
    const messages=JSON.parse(body).messages;
    const payload=JSON.parse(messages[1].content);
    const value=payload.evidence?pass(payload.evidence.at(-1).id):{tasks:[{...plan.tasks[0],proof:'answer'}],prompt:plan.prompt};
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  storeProvider(home,{format:'openai',base:'http://127.0.0.1:'+server.address().port+'/v1',key:'synthetic-test-key',model:'fixture'});
  if(process.platform==='win32')assert.doesNotMatch(fs.readFileSync(path.join(home,'provider.json'),'utf8'),/synthetic-test-key/);
  assert.equal(typeof reviewer(home),'function');
  install({home,codex:path.join(dir,'codex')});
  const runtime=path.join(home,'runtime'),entry=path.join(runtime,fs.readdirSync(runtime)[0],'bin','codex-hook.js');
  async function invoke(input) {
    const child=spawn(process.execPath,[entry],{env:{...process.env,HOME:dir,USERPROFILE:dir},stdio:['pipe','pipe','pipe']});
    const finished=once(child,'close'); let output=''; child.stdout.on('data',d=>output+=d);
    child.stdin.end(JSON.stringify(input)); assert.equal((await finished)[0],0); return JSON.parse(output);
  }
  const a=await invoke(event('UserPromptSubmit','A','1',{prompt:'Say hello to the user.'}));
  assert.match(a.hookSpecificOutput.additionalContext,/Fully implement/);
  const b=await invoke(event('Stop','A','1',{last_assistant_message:'hello'}));
  assert.match(b.systemMessage,/通过/);
});
