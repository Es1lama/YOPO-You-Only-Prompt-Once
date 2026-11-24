import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { handle } from '../src/native.js';
import { hash } from '../src/storage.js';
import { storeProvider } from '../src/provider.js';
import { withTarget } from '../src/native-state.js';
import { windowsReviewChat } from '../src/windows-review-chat.js';

// Real desktop UI, configured transport, task handles, storage and Stop path;
// only the two model/server sides are replaced. No real Codex or user configuration.
export async function createReviewDemo() {
  const parent=fs.realpathSync(os.tmpdir()), home=fs.mkdtempSync(path.join(parent,'yo-po-review-demo-'));
  const key=randomUUID(), receipts=new Map(), ids=new Map();
  const server=http.createServer(async(req,res)=>{
    try {
      if (req.method!=='POST' || req.url!=='/v1/chat/completions' || req.headers.authorization!=='Bearer '+key) {
        res.writeHead(403);res.end();return;
      }
      const chunks=[];let n=0;
      for await (const b of req) { n+=b.length;if(n>200000){res.writeHead(413);res.end();return;}chunks.push(b); }
      const request=JSON.parse(Buffer.concat(chunks)), p=JSON.parse(request.messages[1].content);
      let value;
      if (p.messages) {
        const typed=p.messages.filter(m=>m.role==='user' && !m.text.startsWith('请把我们在这个窗口讨论')).at(-1)?.text;
        value={reply:typed?'这是本机模拟回复。可以把你说的重点整理成下面的验收标准；你可以改字，也可以不应用。':'请先告诉我你想核对什么。',
          draft:typed?'核对「'+typed.slice(0,160)+'」；缺少可观察的依据时，列出缺项，不直接判定通过。':null};
      } else if (p.evidence) {
        const prior=receipts.get(p.originalGoal);
        receipts.set(p.originalGoal,{count:(prior?.count || 0)+1,rule:p.taskReviewRule || null});
        // Keep the sample task available so the user can compare multiple approvals.
        value={verdict:'revise',reason:'演示任务保留以便继续对比。',gaps:['继续核对模拟样本。'],evidence:[],nextPrompt:'核对本机演示样本。'};
      } else {
        value={tasks:[{title:'核对样本',acceptance:'给出有依据的结论',proof:'answer'}],prompt:'只在本机核对该演示样本。'};
      }
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
    } catch {res.writeHead(400);res.end();}
  });
  let closed=false;
  async function close() {
    if (closed) return;closed=true;
    if (server.listening) {server.closeAllConnections();await new Promise(r=>server.close(r));}
    if (path.dirname(home)!==parent || !path.basename(home).startsWith('yo-po-review-demo-')) throw Error('临时目录位置异常。');
    fs.rmSync(home,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
  const emit=(id,kind,content)=>handle({hook_event_name:kind,session_id:id,turn_id:'demo-turn',...content},{home});
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    storeProvider(home,{format:'openai',base:'http://127.0.0.1:'+server.address().port+'/v1',model:'本机模拟审查员',key});
    for (const [name,goal] of [['A','任务 A：核对商品详情页的尺码说明'],['B','任务 B：校对海报中的时间与地点']]) {
      const id='demo-'+name+'-'+randomUUID();ids.set(hash(id),id);
      const out=await emit(id,'UserPromptSubmit',{prompt:goal});
      if (!out.hookSpecificOutput) throw Error('本机模拟任务初始化失败。');
    }
    async function onDemoReview(target) {
      const id=ids.get(target?.session);if (!id) throw Error('不是本次体验中的任务。');
      const goal=withTarget(home,target,(_dir,s)=>s.goal), before=receipts.get(goal)?.count || 0;
      const result=await emit(id,'Stop',{last_assistant_message:'这是临时样本。'});
      const receipt=receipts.get(goal);
      if (!receipt || receipt.count===before || result.decision!=='block') throw Error('本机模拟审查未执行，无可核对的结果。');
      return goal+'：'+(receipt.rule?'第 '+receipt.rule.revision+' 版「'+receipt.rule.text+'」':'没有收到任务专属规则。');
    }
    return {options:{home,onDemoReview},close};
  } catch(e) {await close();throw e;}
}

export async function runReviewDemo() {
  if (process.platform!=='win32') throw Error('桌面预览需要 Windows。');
  const preview=await createReviewDemo();
  try {await windowsReviewChat(preview.options);}
  finally {await preview.close();}
}
