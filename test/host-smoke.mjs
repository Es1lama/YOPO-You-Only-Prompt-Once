// Optional acceptance test with an installed Codex binary. Both model endpoints are local fixtures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import * as zlib from 'node:zlib';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { install, hookStatus } from '../src/install-hooks.js';
import { storeProvider } from '../src/provider.js';
import { fileURLToPath } from 'node:url';
import { connect } from '../src/codex.js';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'yo-po-host-'));
const codexHome=path.join(temp,'.codex'), data=path.join(temp,'.yo-po'), workspace=path.join(temp,'project-a'), other=path.join(temp,'project-b');
for (const p of [workspace,other]) fs.mkdirSync(p);
let executions=0, reviews=0, initialPrompts=0, observedTool;
const requests=[], routes=[], reviewGoals=[];
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1');
    if (url.hostname!=='127.0.0.1') {res.writeHead(403);res.end();return;}
    routes.push([req.method,url.pathname,req.headers['content-encoding']]);
    const chunks=[]; for await (const c of req) chunks.push(c);
    let bytes=Buffer.concat(chunks);
    if(req.headers['content-encoding']==='zstd') bytes=zlib.zstdDecompressSync(bytes);
    if(req.headers['content-encoding']==='gzip') bytes=zlib.gunzipSync(bytes);
    const data=JSON.parse(bytes.toString() || '{}');
    if(url.pathname==='/review/chat/completions'){
      assert.equal(req.headers.authorization,'Bearer fixture');
      assert.equal(data.model,'vendor/non-google-reviewer');
      const request=JSON.parse(data.messages[1].content); let value;
      reviewGoals.push(request.originalGoal);
      if(!request.evidence){initialPrompts++;value={tasks:[{title:'answer',acceptance:'reply twice after a revision',proof:'answer'}],prompt:'Produce the requested textual answer.'};}
      else if(++reviews%2===1){value={verdict:'revise',reason:'first answer was missing a detail',gaps:['Include the fixture detail'],evidence:[],nextPrompt:'Include the second detail.'};}
      else {
        observedTool=request.evidence.find(r=>r.type==='toolStatus');
        value={verdict:'pass',reason:'verified written answer',gaps:[],evidence:[request.evidence.at(-1).id],nextPrompt:''};
      }
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]})); return;
    }
    if(url.pathname==='/v1/responses' && req.method==='POST'){
      const n=++executions, step=(n-1)%3+1, id='resp_fixture_'+n, text=step===1?'First fixture answer.':'Final fixture answer with second detail.';
      requests.push(JSON.stringify(data.input));
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
      const item=step===2 ? {type:'function_call',id:'fc_fixture',call_id:'call_fixture',name:'get_goal',arguments:'{}',status:'completed'} :
        {type:'message',id:'msg_fixture_'+n,role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
      const response={id,object:'response',created_at:1700000000,status:'completed',model:'fixture',output:[item],usage:{input_tokens:6,output_tokens:6,total_tokens:12}};
      const send=(type,fields)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...fields})+'\n\n');
      send('response.created',{response:{...response,status:'in_progress',output:[]}});
      if(step!==2) {
        send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});
        send('response.output_text.delta',{output_index:0,content_index:0,item_id:item.id,delta:text});
      }
      send('response.output_item.done',{output_index:0,item});
      send('response.completed',{response});res.end(); return;
    }
    res.writeHead(404);res.end('{}');
  }catch(e){routes.push(['error',e.name]);res.writeHead(500);res.end('{}');}
});
server.listen(0,'127.0.0.1'); await once(server,'listening');
try{
  const base='http://127.0.0.1:'+server.address().port;
  install({home:data,codex:codexHome});
  storeProvider(data,{format:'openai',base:base+'/review',model:'vendor/non-google-reviewer',key:'fixture'});
  const cfg=path.join(codexHome,'config.toml');
  fs.writeFileSync(cfg,[
    'model = "fixture"','model_provider = "fixture"','[model_providers.fixture]','name = "Local fixture"',
    'base_url = '+JSON.stringify(base+'/v1'),'wire_api = "responses"','supports_websockets = false','requires_openai_auth = false','request_max_retries = 0','stream_max_retries = 0'
  ].join('\n')+'\n');
  const env={};
  for (const k of Object.keys(process.env)) if (/^(path|pathext|systemroot|comspec|windir|temp|tmp|localappdata|appdata|programfiles(?:\(x86\))?|programdata|lang|systemdrive)$/i.test(k)) env[k]=process.env[k];
  Object.assign(env,{HOME:temp,USERPROFILE:temp,CODEX_HOME:codexHome,NO_PROXY:'localhost,127.0.0.1',HTTP_PROXY:base,HTTPS_PROXY:base,ALL_PROXY:base});
  async function list(){
    const c=connect(env);
    try{await c.initialize();return (await c.call('hooks/list',{cwds:[workspace,other]})).data;}finally{c.close();}
  }
  const hookEntries=(await list()).map(row=>row.hooks.filter(h=>h.statusMessage?.startsWith('Yo-po')));
  assert.equal(hookEntries.length,2);
  for(const entries of hookEntries) assert.equal(entries.length,4);
  assert.equal((await hookStatus({home:data,codex:codexHome,env,cwd:workspace})).state,'needs-trust');
  // Trust only our inspected, disposable fixture definitions in the temporary Codex profile.
  for(const h of hookEntries[0]) fs.appendFileSync(cfg,'\n[hooks.state.'+JSON.stringify(h.key)+']\ntrusted_hash = '+JSON.stringify(h.currentHash)+'\n');
  assert.ok((await list()).every(row=>row.hooks.filter(h=>h.statusMessage?.startsWith('Yo-po')).every(h=>h.trustStatus==='trusted')));
  const stableFiles = [cfg,path.join(codexHome,'hooks.json'),path.join(data,'installed.json'),path.join(data,'provider.json')];
  const snapshot = () => stableFiles.map(f=>fs.readFileSync(f,'utf8'));
  const installed = snapshot();
  async function runProcess(bin,args,cwd) {
    const proc = spawn(bin,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let out='',err='';
    proc.stdout.on('data',d=>out+=d); proc.stderr.on('data',d=>err+=d);
    const timer=setTimeout(()=>proc.kill(),70000);
    try {
      const [code]=await once(proc,'close');
      assert.equal(code,0,JSON.stringify({code,routes,errors:err.slice(-1200),events:out.slice(-2000)}));
    } finally {clearTimeout(timer);}
    return out;
  }
  // Reopening the installer with closed stdin must need neither the API nor another trust decision.
  const setup = new URL('../bin/yo-po.js',import.meta.url);
  const setupOut = await runProcess(process.execPath,[fileURLToPath(setup),'setup'],workspace);
  assert.match(setupOut,/Codex 已启用自动审查/);
  assert.equal(initialPrompts,0);
  assert.deepEqual(snapshot(),installed);
  const chats = [];
  for (const [index,project] of [workspace,other].entries()) {
    const goal='Write a greeting for local project '+(index+1)+'.';
    const output = await runProcess(process.env.CODEX_BIN || 'codex',
      ['exec','--skip-git-repo-check','--sandbox','read-only','--json','-C',project,goal],project);
    const thread = output.trim().split(/\r?\n/).map(l=>JSON.parse(l)).find(e=>e.type==='thread.started');
    assert.ok(thread?.thread_id); chats.push(thread.thread_id);
    assert.deepEqual([initialPrompts,reviews,executions],[index+1,(index+1)*2,(index+1)*3]);
    assert.deepEqual(reviewGoals.slice(index*3),[goal,goal,goal]);
    assert.match(requests[index*3],/Produce the requested textual answer/);
    assert.match(requests[index*3+1],/Include the second detail/);
    assert.match(JSON.parse(observedTool.detail).tool,/get_goal/i);
  }
  assert.notEqual(chats[0],chats[1]);
  const followup='Write a different greeting in the resumed local chat.';
  const resumed=await runProcess(process.env.CODEX_BIN || 'codex',
    ['exec','--sandbox','read-only','resume','--skip-git-repo-check','--json',chats[0],followup],workspace);
  assert.ok(resumed.trim().split(/\r?\n/).map(l=>JSON.parse(l)).some(e=>e.type==='thread.started' && e.thread_id===chats[0]));
  assert.deepEqual(reviewGoals.slice(-3),[followup,followup,followup]);
  assert.deepEqual([initialPrompts,reviews,executions],[3,6,9]);
  assert.deepEqual(snapshot(),installed);
  console.log('Three Codex launches: two projects, two new chats and one resumed chat. Each reused the saved non-Gemini connection and completed one automatic revision. Setup required no repeat input. Hook definitions and trust stayed identical. Both model endpoints were local fixtures.');
}finally{
  server.closeAllConnections(); await new Promise(r=>server.close(r));
  fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:150});
}
