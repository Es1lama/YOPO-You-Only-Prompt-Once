import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handle } from '../src/native.js';
import { hash } from '../src/storage.js';

const plan={tasks:[{title:'写出短句',acceptance:'有书面回答',proof:'answer'}],prompt:'Write the requested short answer.'};
const again={verdict:'revise',reason:'One detail is missing.',gaps:['Add that detail.'],evidence:[],nextPrompt:'Add the missing detail.'};
const done=p=>({verdict:'pass',reason:'Written answer checked.',gaps:[],evidence:[p.evidence.at(-1).id],nextPrompt:''});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {resolve,promise};};

async function fixture(t, responder) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'yopo-chat-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true,maxRetries:5}));
  const globalFile=path.join(home,'reviewer.md');
  fs.writeFileSync(globalFile,'GLOBAL ORIGINAL\n'); const calls=[];
  const ask=async(kind,sys,p)=>{
    calls.push({kind,sys,p});
    if (responder) { const v=await responder(kind,sys,p,calls); if(v!==undefined) return v; }
    if(kind==='dispatch') return plan;
    if(kind==='review') return again;
    if(kind==='reviewChat') return {reply:'可以，只看足够的证据。',draft:'模型的建议（还未应用）'};
    throw Error('unexpected operation: '+kind);
  };
  const emit=(id,turn,kind,extra={})=>handle({hook_event_name:kind,session_id:id,turn_id:turn,
    transcript_path:path.join(home,'MUST-NOT-READ.jsonl'),...extra},{home,ask});
  const start=(id,goal,turn='1')=>emit(id,turn,'UserPromptSubmit',{prompt:goal});
  const stop=(id,turn='1')=>emit(id,turn,'Stop',{last_assistant_message:'raw Codex answer SECRET_EXCERPT'});
  // Loading the desk only at its use site also exercises the real hook fixture on a pre-feature runtime.
  const module=await import('../src/review-chat.js').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
  assert.equal(typeof module.createReviewDesk,'function','a separate reviewer desk is available');
  const newDesk=()=>module.createReviewDesk({home,ask});
  return {home,globalFile,calls,emit,start,stop,desk:newDesk(),newDesk};
}

test('side chat does not change Codex or publish local task data; only edited, explicitly applied text reaches the selected run’s reviews',async t=>{
  const f=await fixture(t); const {desk}=f;
  await f.start('A','核对 A 的私有目标 TASK_A_SECRET'); await f.start('B','核对 B 的私有目标 TASK_B_SECRET');
  await f.emit('A','1','PostToolUse',{tool_name:'Bash',tool_input:{command:'echo RAW-COMMAND'},tool_response:{exit_code:0,output:'RAW-STDOUT'}});
  const tasks=desk.list(), a=tasks.find(v=>v.session===hash('A')), b=tasks.find(v=>v.session===hash('B'));
  assert.equal(tasks.length,2);assert.ok(a.updatedAt && b.run!==a.run);
  const activeFile=path.join(f.home,'sessions',a.session,'active.json'),snapshot=fs.readFileSync(activeFile,'utf8');
  desk.select(a);
  const res=await desk.send(a,'你好 SIDE-ONLY，请整理要求');
  assert.equal(res.draft,'模型的建议（还未应用）');
  const chatCall=f.calls.find(c=>c.kind==='reviewChat');
  assert.match(JSON.stringify(chatCall.p),/SIDE-ONLY/);
  assert.doesNotMatch(JSON.stringify(chatCall),/TASK_[AB]_SECRET|SECRET_EXCERPT|RAW-COMMAND|RAW-STDOUT|MUST-NOT-READ|GLOBAL ORIGINAL/);
  assert.equal(fs.readFileSync(activeFile,'utf8'),snapshot);
  await f.stop('A');assert.doesNotMatch(JSON.stringify(f.calls.at(-1)),/SIDE-ONLY|模型的建议/);
  const busyState=fs.readFileSync(activeFile,'utf8'); const count=f.calls.length;
  const edited='用户已改：逐条核对引用的依据。';
  assert.equal(desk.apply(a,edited).revision,1); assert.equal(f.calls.length,count);
  assert.equal(fs.readFileSync(activeFile,'utf8'),busyState);
  await f.stop('B'); assert.doesNotMatch(JSON.stringify(f.calls.at(-1)),/用户已改|SIDE-ONLY|模型的建议/);
  // A normal new-turn hook, not a synthetic message from the side chat.
  await f.start('A','另外检查句号。','2'); assert.doesNotMatch(JSON.stringify(f.calls.at(-1)),/用户已改|SIDE-ONLY/);
  await f.stop('A','2'); const audit=f.calls.at(-1);
  assert.equal(audit.kind,'review'); assert.equal(audit.p.taskReviewRule.text,edited); assert.equal(audit.p.originalGoal,'核对 A 的私有目标 TASK_A_SECRET');
  assert.doesNotMatch(JSON.stringify(audit),/SIDE-ONLY|模型的建议/);assert.doesNotMatch(audit.sys,/用户已改/);
  assert.equal(fs.readFileSync(f.globalFile,'utf8'),'GLOBAL ORIGINAL\n');
  desk.select(b); await desk.send(b,'B 这边的新问题');assert.doesNotMatch(JSON.stringify(f.calls.at(-1)),/SIDE-ONLY|用户已改|模型的建议/);
});

test('approval while a real Stop request is waiting leaves that result valid and takes effect on the next Stop',async t=>{
  const started=deferred(), unblock=deferred();let n=0;
  const f=await fixture(t,async(kind)=>{if(kind==='review' && ++n===1){started.resolve();await unblock.promise;return again;}});
  await f.start('A','Write an observable greeting.'); const [a]=f.desk.list(); f.desk.select(a);
  const first=f.stop('A'); await started.promise;
  try { const result=f.desk.apply(a,'下一次再核对标点');assert.equal(result.phase,'reviewing'); }
  finally {unblock.resolve();}
  assert.equal((await first).decision,'block');const c1=f.calls.filter(c=>c.kind==='review')[0];assert.ok(!c1.p.taskReviewRule);
  await f.stop('A');assert.equal(f.calls.at(-1).p.taskReviewRule.text,'下一次再核对标点');
});

test('stale, completed, interrupted, disabled and closed-book task handles cannot apply or contact the model',async t=>{
  const f=await fixture(t,(kind,_s,p)=>kind==='review'?done(p):undefined);
  await f.start('A','First task.');const [old]=f.desk.list();f.desk.select(old);f.desk.apply(old,'ONLY OLD RUN');
  await f.stop('A');assert.equal(f.desk.list().length,0);
  await f.start('A','Another task.','2');const [next]=f.desk.list();assert.notEqual(next.run,old.run);
  assert.throws(()=>f.desk.apply(old,'wrong target'));await assert.rejects(f.desk.send(old,'must not send'));assert.equal(f.calls.length,3);
  assert.equal(f.desk.select(next).applied.revision,0);
  await f.stop('A','2');assert.doesNotMatch(JSON.stringify(f.calls.at(-1)),/ONLY OLD RUN/);
  for(const [id,stop] of [['B','闭卷回答'],['C','Yo-po off'],['D','Interrupt']]){
    await f.start(id,'A public task.');const [task]=f.desk.list();f.desk.select(task);
    if(stop==='Interrupt')await f.emit(id,'1','Interrupt');else await f.start(id,stop,'2');
    const count=f.calls.length;assert.equal(f.desk.list().length,0);
    assert.throws(()=>f.desk.apply(task,'lost target'));await assert.rejects(f.desk.send(task,'no lookup'));assert.equal(f.calls.length,count);
  }
});

test('ignore a late reply after privacy or switching selection; two desks cannot silently overwrite, and malformed targets cannot navigate',async t=>{
  const started=deferred(), unblock=deferred();
  const f=await fixture(t,async kind=>{if(kind==='reviewChat'){started.resolve();await unblock.promise;return {reply:'LATE',draft:'DO NOT APPLY'};}});
  await f.start('A','公开 A'); await f.start('B','公开 B');
  const [a,b]=f.desk.list();f.desk.select(a);const other=f.newDesk();other.select(a);
  other.apply(a,'First confirmed');assert.throws(()=>f.desk.apply(a,'stale overwrite'),/其他窗口|更新/);
  f.desk.select(a);
  const waiting=f.desk.send(a,'迟到的回答');
  await started.promise;f.desk.select(b);unblock.resolve();await assert.rejects(waiting);
  assert.throws(()=>f.desk.select({...a,session:'../outside'}));
  assert.throws(()=>f.desk.select({...a,run:'../outside'}));assert.throws(()=>f.desk.apply(a,''));
  f.desk.select(b);assert.throws(()=>f.desk.apply(b,'x'.repeat(2001)),/2000/);
});

test('a side-chat request superseded by a private turn cannot surface or apply a model result',async t=>{
  const started=deferred(), unblock=deferred();
  const f=await fixture(t,async kind=>{if(kind==='reviewChat'){started.resolve();await unblock.promise;return {reply:'late',draft:'late private draft'};}});
  await f.start('A','Public');const [a]=f.desk.list();f.desk.select(a);
  const pending=f.desk.send(a,'public discussion');
  await started.promise;await f.start('A','本次会话不联网','2');unblock.resolve();
  await assert.rejects(pending);assert.throws(()=>f.desk.apply(a,'manual'));assert.equal(f.desk.list().length,0);
});

test('a corrupted confirmed rule reports a failed audit without leaking the file or contacting the reviewer',async t=>{
  const f=await fixture(t);await f.start('A','Public');const [a]=f.desk.list();f.desk.select(a);f.desk.apply(a,'User checked');
  fs.writeFileSync(path.join(f.home,'sessions',a.session,a.run,'review-rule.json'),'{CORRUPT_SECRET');
  const count=f.calls.length;const result=await f.stop('A');
  assert.match(result.systemMessage,/未.*审查|未验收/);assert.doesNotMatch(result.systemMessage,/CORRUPT_SECRET/);
  assert.equal(result.decision,undefined);assert.equal(f.calls.length,count);
});
