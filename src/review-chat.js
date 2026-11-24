import fs from 'node:fs';
import path from 'node:path';
import { json } from './storage.js';
import { redact } from './evidence.js';
import { userDir, reviewer } from './provider.js';
import { available, realDir, realFile, validSession, stale, withTarget, readRule, writeRule, ruleLimit } from './native-state.js';

const guide='你是用户单独交谈的审查搭档，不是 Codex 执行者。你只看得到这个窗口主动发送的讨论，不知道原始任务或执行进度。不要假装读取了别处的内容。帮用户把验收重点写成可观察的标准；信息不足就问一个具体问题。不要执行、派工、增权、放宽原目标约束、保证通过或声称已应用。请用用户的语言回答。';
const same=(a,b)=>a && b && a.session===b.session && a.run===b.run;
const checked=(text,limit,label)=>{
  if (typeof text!=='string' || !text.trim() || text.length>limit || text.includes('\0')) throw Error(label+'须为 1 至 '+limit+' 个字符的文字。');
  return text.trim();
};

function list(home) {
  const root=path.join(home,'sessions');
  if (!realDir(root)) return [];
  const result=[];
  for (const ent of fs.readdirSync(root,{withFileTypes:true})) {
    if (!ent.isDirectory() || !validSession(ent.name)) continue;
    const file=path.join(root,ent.name,'active.json');
    try {
      if (!realFile(file)) continue;
      const s=json(file); if (!available(s)) continue;
      // The native goal is already redacted. Keep only a short local label, never a chat input.
      const goal=redact(s.goal).replace(/[\s\u0000-\u001f]+/g,' ').trim();
      result.push({session:ent.name,run:s.run,goal:goal.slice(0,72)+(goal.length>72?'…':''),
        phase:s.phase,round:s.round,updatedAt:fs.statSync(file).mtime.toISOString()});
    } catch { /* An unreadable or replaced entry is never a selectable target. */ }
  }
  return result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt) || a.session.localeCompare(b.session));
}

// Deliberately no Codex client, transcript loader, feedback writer, or hook invocation in this module.
// History is per window and per selection. Only an explicit apply() writes anything.
export function createReviewDesk({home=userDir(),ask}={}) {
  let view=null;
  const current=target=>{if (!same(view,target)) throw stale(); return view;};
  return {
    list:()=>list(home),
    select(target) {
      view?.controller?.abort();
      view=null;
      if (!target) return null;
      return withTarget(home,target,(dir,s)=>{
        const applied=readRule(dir,s);
        view={session:target.session,run:target.run,revision:applied.revision,history:[],busy:false};
        return {phase:s.phase,round:s.round,applied};
      });
    },
    async send(target,value,mode='chat') {
      const turn=current(target);
      if (turn.busy) throw Error('请等上一个问题回复。');
      if (!['chat','draft'].includes(mode)) throw Error('未知对话操作。');
      const text=checked(value,2000,'消息'), msg={role:'user',text:redact(text)};
      withTarget(home,target,()=>{}); // No lock across provider I/O.
      let history=[...turn.history];
      // Keep complete pairs; the newest 3 exchanges and current input have a separate total budget.
      while (history.length && JSON.stringify([...history,msg]).length>12000) history=history.slice(2);
      turn.busy=true;
      turn.controller=new AbortController();
      try {
        const p={mode,messages:[...history,msg]};
        const answer=await (ask || reviewer(home,process.env,turn.controller.signal))('reviewChat',guide,p);
        if (view!==turn) throw stale();
        withTarget(home,target,()=>{});
        const reply=checked(answer?.reply,4000,'审查回复');
        const draft=answer.draft==null || answer.draft==='' ? null : checked(answer.draft,ruleLimit,'规则草案');
        turn.history=[...history,msg,{role:'assistant',text:redact(reply),...(draft?{draft:redact(draft)}:{})}].slice(-6);
        return {reply,draft};
      } finally { turn.busy=false; turn.controller=null; }
    },
    apply(target,value) {
      const turn=current(target),text=checked(value,ruleLimit,'规则');
      return withTarget(home,target,(dir,s)=>{
        const row=writeRule(dir,s,text,turn.revision);
        turn.revision=row.revision;
        return {...row,phase:s.phase};
      });
    }
  };
}
