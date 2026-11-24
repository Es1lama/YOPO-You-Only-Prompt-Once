import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { install } from '../src/install-hooks.js';
import { storeProvider } from '../src/provider.js';

test('installed hooks stay in their own profile; real window protocol uses that saved reviewer without sending Codex material',async t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yopo-window-')),home=path.join(tmp,'isolated'), wrong=path.join(tmp,'must-not-use');
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true,maxRetries:5}));
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let bytes='';for await(const b of req)bytes+=b;
    const body=JSON.parse(bytes);requests.push(body);
    assert.equal(body.model,'preview-fixture');assert.equal(req.headers.authorization,'Bearer FAKE-local');
    const p=JSON.parse(body.messages[1].content);
    const result=p.messages ? {reply:'先看证据。',draft:'测试模型草案。'} :
      p.evidence ? {verdict:'pass',reason:'verified',gaps:[],evidence:[p.evidence.at(-1).id],nextPrompt:''} :
      {tasks:[{title:'Do it',acceptance:'written answer',proof:'answer'}],prompt:'Respond.'};
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}));
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
  storeProvider(home,{key:'FAKE-local',model:'preview-fixture',format:'openai',base:'http://127.0.0.1:'+server.address().port+'/v1'});
  install({home,codex:path.join(tmp,'codex')});
  const runtime=path.join(home,'runtime'),hook=path.join(runtime,fs.readdirSync(runtime)[0],'bin','codex-hook.js');
  async function invoke(kind,extra){
    const disabledEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(YOPO_|GEMINI_|GOOGLE_API_KEY$)/i.test(k)));
    const profile=path.join(tmp,'fake-os-profile');
    const child=spawn(process.execPath,[hook],{env:{...disabledEnv,HOME:profile,USERPROFILE:profile,YOPO_HOME:wrong},windowsHide:true,stdio:['pipe','pipe','pipe']});
    const end=once(child,'close');child.stdout.setEncoding('utf8');let out='';child.stdout.on('data',s=>out+=s);
    child.stdin.end(JSON.stringify({hook_event_name:kind,session_id:'invisible-id',turn_id:'1',...extra}));
    assert.equal((await end)[0],0);return JSON.parse(out);
  }
  const dispatch=await invoke('UserPromptSubmit',{prompt:'Chinese goal 绝不能自动发到旁聊。'});
  assert.ok(dispatch.hookSpecificOutput,'the copied hook must find the preview provider, not fall back to home');
  const {createReviewChannel}=await import('../src/windows-review-chat.js');
  const channel=createReviewChannel({home});
  const list=await channel.request({type:'list'});
  assert.equal(list.tasks.length,1);assert.match(list.model,/preview-fixture/);const target=list.tasks[0];
  await channel.request({type:'select',target,view:2});
  const answer=await channel.request({type:'message',target,view:2,text:'消息甲'});assert.equal(answer.draft,'测试模型草案。');
  assert.equal(answer.view,2);assert.equal(requests.length,2);
  assert.doesNotMatch(JSON.stringify(requests[1]),/绝不能自动发到旁聊|invisible-id|FAKE-local/);
  const applied=await channel.request({type:'apply',target,view:2,text:'亲自编辑：核对断行。'});assert.equal(applied.revision,1);assert.equal(requests.length,2);
  const stop=await invoke('Stop',{last_assistant_message:'你好。'});assert.match(stop.systemMessage,/通过/);
  const last=JSON.parse(requests.at(-1).messages[1].content);assert.equal(last.taskReviewRule.text,'亲自编辑：核对断行。');
  assert.doesNotMatch(JSON.stringify(last),/消息甲|测试模型草案/);
  assert.deepEqual(fs.existsSync(wrong)?fs.readdirSync(wrong):[],[],'unexpected writes in the ambient profile');
  channel.close();
});
