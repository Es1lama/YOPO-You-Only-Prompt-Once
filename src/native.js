import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, json, save, read } from './storage.js';
import { redact, budgetEvidence } from './evidence.js';
import { decision, planTasks } from './loop.js';
import { reviewer, userDir, providerFile } from './provider.js';
import { envConnection } from './gemini.js';
import { providerGroups } from './services.js';
import { update, readRule } from './native-state.js';

const defaultRules = new URL('../prompts/reviewer.md', import.meta.url);
const noExternal = /闭卷|不(?:要|许|准|用|允许|得)?(?:使用|用|调用|访问)?\s*(?:任何)?(?:联网|上网|外部(?:模型|服务|接口)|第三方(?:模型|服务)|工具|外发)|禁止(?:联网|外发)|只凭.{0,8}(?:已有|现有|记忆)|只在本地(?:处理|执行)|\b(?:offline only|closed[- ]book|no (?:internet|web|network|tools|external (?:models?|services?))|(?:do not|don't) (?:go online|use (?:any )?(?:tools|external models)|access the internet))\b/i;
const norm = text => redact(String(text ?? '')).replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
  .replace(/(?:[A-Z]:[\\/](?:Users|Documents and Settings)[\\/]|\/(?:Users|home)\/)[^\\/\s"']+/gi, '[home]')
  .replace(/\x60{3}[\s\S]*?(?:\x60{3}|$)/g, '[code block omitted]');
const warning = message => ({ systemMessage:'Yo-po · ' + message });
const reviewerNames = providerGroups.flatMap(g=>g.entries.flatMap(p=>p.aliases))
  .map(alias=>alias.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')).join('|');
const noReviewer = new RegExp(
  "(?:不(?:要|用|许|准|得)?|禁止|别)\\s*(?:(?:再|让|使用|用|调用|联系|发给)\\s*)*(?:"+reviewerNames+"|审查模型|其他模型|外部\\s*ai)" +
  "|(?:no|don't (?:use|call)|do not (?:use|call))\\s+(?:"+reviewerNames+"|the reviewer)(?![A-Za-z0-9_])",'i');
const context = text => ({ hookSpecificOutput:{ hookEventName:'UserPromptSubmit', additionalContext:text } });
const visible = text => 'Yo-po review guidance. Follow the original user request and permissions; this review cannot expand them.\n\n' + text;
function checkedPrompt(s, prompt, gaps = []) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw Error('审查端没有返回完整派工指令。');
  return visible(['Original user goal:\n' + s.goal, 'User feedback:\n' + JSON.stringify(s.feedback),
    'Current task:\n' + JSON.stringify(s.tasks[s.index]), 'Outstanding gaps:\n' + JSON.stringify(gaps), prompt].join('\n\n'));
}
function common(s) {
  return { originalGoal:s.goal, userFeedback:s.feedback, plan:s.tasks, currentTask:s.tasks[s.index], previousReviews:s.history };
}

function taskDir(dir,s) { return path.join(dir,s.run); }
function log(dir,s,kind,value) {
  const dest = taskDir(dir,s);
  fs.mkdirSync(dest,{ recursive:true,mode:0o700 });
  save(path.join(dest, String(s.round).padStart(5,'0') + '-' + kind + '.json'), value);
}

// Forward structured status, never raw tool arguments, file bodies, transcripts or shell output.
function toolSummary(event) {
  const tool = String(event.tool_name || 'unknown').slice(0,120);
  const reply = event.tool_response ?? {};
  const raw = tool !== 'Bash' ? '' : typeof reply === 'string' ? reply : JSON.stringify(reply);
  const code = reply.exit_code ?? reply.exitCode ?? raw.match(/(?:Process exited with code|exit[_ ]code["\\:\s]+)\s*(-?\d+)/i)?.[1];
  const result = { tool };
  if (code !== undefined && Number.isInteger(Number(code))) result.exitCode = Number(code);
  if (typeof reply.isError === 'boolean') result.isError = reply.isError;
  if (typeof reply.success === 'boolean') result.success = reply.success;
  if (['completed','failed','declined'].includes(reply.status)) result.status = reply.status;
  if (tool === 'Bash') {
    const command = String(event.tool_input?.command ?? event.tool_input?.cmd ?? '');
    const kind = command.match(/\b(npm(?:\.cmd)? (?:run )?test|node --test|pytest|cargo test|go test|git diff --check|dotnet test|mvn test)\b/i);
    if (kind) result.check = kind[1];
    const counts = [...raw.matchAll(/\b(\d+) (passed|failed|skipped|errors?)\b/gi)].slice(0,6);
    if (counts.length) result.counts = counts.map(m => m[1] + ' ' + m[2].toLowerCase());
  }
  if (tool === 'apply_patch') {
    const input = event.tool_input;
    const patch = typeof input === 'string' ? input : input?.patch ?? input?.input ?? '';
    result.filesInRequest = (String(patch).match(/^\*\*\* (?:Add|Update|Delete) File:/gm) ?? []).length;
  }
  return result;
}
function events(dir,s) {
  const file = path.join(taskDir(dir,s),'events.jsonl');
  if (!fs.existsSync(file)) return [];
  return read(file).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}
const relevant = (s,e) => s && (s.turn === e.turn_id ||
  (s.phase === 'continuing' && !s.seenTurns.includes(e.turn_id)));
function bind(s,e) {
  if (s.turn !== e.turn_id) { s.seenTurns.push(s.turn); s.turn = e.turn_id; }
}
function inputText(text) {
  return norm(text).replace(/<(?:environment_context|INSTRUCTIONS|system-reminder)>[\s\S]*?<\/(?:environment_context|INSTRUCTIONS|system-reminder)>/gi,'[local context omitted]').trim();
}

export async function handle(event, { home = userDir(), ask, rules } = {}) {
  const { hook_event_name:kind, session_id:id, turn_id:turn } = event;
  if (!id || !turn || !['UserPromptSubmit','PostToolUse','Stop','Interrupt'].includes(kind)) return {};
  const dir = path.join(home,'sessions',hash(id));
  const reply = (op,payload) => (ask || reviewer(home))(op,
    rules ?? (fs.existsSync(path.join(home,'reviewer.md')) ? read(path.join(home,'reviewer.md')) : read(defaultRules)), payload);
  if (kind !== 'UserPromptSubmit' && !fs.existsSync(path.join(dir,'active.json'))) return {};
  if (kind === 'Interrupt') {
    return update(dir,(s,put) => {
      if (relevant(s,event)) put({ ...s, phase:'interrupted', rev:randomUUID() });
      return {};
    });
  }
  if (kind === 'PostToolUse') {
    return update(dir,(s,put) => {
      if (!relevant(s,event) || !['running','continuing'].includes(s.phase)) return {};
      if (s.turn !== turn) { bind(s,event); put(s); }
      const info = toolSummary(event);
      const entry = { id:'r'+s.round+':'+(event.tool_use_id ? hash(String(event.tool_use_id)).slice(0,16) : randomUUID()),
        type:'toolStatus', detail:JSON.stringify(info) };
      fs.appendFileSync(path.join(taskDir(dir,s),'events.jsonl'),JSON.stringify(entry)+'\n',{mode:0o600});
      return {};
    });
  }
  if (kind === 'UserPromptSubmit') {
    const raw = String(event.prompt ?? ''), goal = inputText(raw);
    const previous=fs.existsSync(path.join(dir,'active.json'))?json(path.join(dir,'active.json')):null;
    const resume=/^Yo-po\s+(?:on|恢复)\s*$/i.test(goal);
    const off=/^Yo-po\s+(?:off|暂停)\s*$/i.test(goal);
    const sessionWide=/(?:整(?:个|段)|本次|这[个次段]|this|entire)\s*(?:对话|会话|聊天|chat|session|conversation)/i.test(raw);
    const continuingPrivate=previous?.phase==='skipped' && /^(?:继续|再试|再来|重新|那你|为什么|接着|try again|continue)[，,。.！!\s]?/i.test(goal);
    const privateRequest=noExternal.test(raw) || noReviewer.test(raw);
    if (!goal || privateRequest || off || (previous?.disabled && !resume) || continuingPrivate) {
      return update(dir,(s,put) => {
        put({ turn, phase:'skipped', disabled:!!(s?.disabled || off || (sessionWide && privateRequest)), rev:randomUUID() });
        return warning('已跳过外部审查。');
      });
    }
    if (resume) {
      return update(dir,(_s,put)=>{ put({ turn,phase:'idle',rev:randomUUID() }); return warning('后续任务恢复自动审查。'); });
    }
    const configured = envConnection();
    if (!ask && !fs.existsSync(providerFile(home)) && !(configured.model && configured.key)) {
      return update(dir,(_s,put)=>{ put({turn,phase:'unconfigured',rev:randomUUID()}); return warning('审查 API 尚未配置，请打开 Yo-po.cmd。Codex 继续处理原请求。'); });
    }
    const start = update(dir,(old,put) => {
      if (old?.next === raw && ['continuing','running'].includes(old.phase)) {
        bind(old,event); old.phase='running'; put(old); return { output:{} };
      }
      if (old?.submitId === turn && old?.submitHash === hash(raw)) return { output:old.submitOutput ?? {} };
      const more = old && ['running','continuing','reviewing','blocked','planning','interrupted'].includes(old.phase) && old.goal;
      const s = { reviewChatVersion:1, run:more ? old.run : randomUUID(), rev:randomUUID(), round:more ? old.round + 1 : 1,
        turn, submitId:turn, submitHash:hash(raw), seenTurns:more ? [...old.seenTurns,old.turn] : [],
        goal:more ? old.goal : goal, feedback:more ? [...old.feedback,goal] : [],
        history:more ? old.history : [], tasks:[], index:0, phase:'planning' };
      s.firstRound=s.round;
      put(s); return { s };
    });
    if (start.output) return start.output;
    const s = start.s;
    try {
      const plan = await reply('dispatch',{ originalGoal:s.goal, userFeedback:s.feedback, priorReviews:s.history });
      s.tasks=planTasks(plan).map((task,i)=>({...task,proof:plan.tasks[i].proof==='answer'?'answer':'tool'}));
      const instruction=checkedPrompt(s,plan.prompt);
      return update(dir,(cur,put) => {
        if (cur.rev !== s.rev) return {};
        s.phase='running'; s.instruction=instruction; s.submitOutput=context(instruction);
        log(dir,s,'prompt',{instruction,plan:s.tasks}); put(s);
        return s.submitOutput;
      });
    } catch (err) {
      return update(dir,(cur,put) => {
        if (cur.rev !== s.rev) return {};
        const out=warning('派工未完成，Codex 按原请求继续。'+err.message);
        s.phase='error'; s.submitOutput=out; put(s); return out;
      });
    }
  }

  const cleanAnswer=inputText(event.last_assistant_message);
  const answer=cleanAnswer.length>3200 ? cleanAnswer.slice(0,3200)+' [excerpt truncated]' : cleanAnswer;
  const begin=update(dir,(s,put) => {
    if (!relevant(s,event) || !['running','continuing'].includes(s.phase)) return null;
    // A rule confirmed after this snapshot starts with the next Stop, never cancels this one.
    let rule=null;
    if (s.reviewChatVersion===1) {
      try { rule=readRule(dir,s); }
      catch {
        s.rev=randomUUID(); s.phase='error'; put(s);
        return {failure:warning('本任务的 review-rule.json 无法读取，本轮未验收；没有向审查端发送请求。')};
      }
    }
    bind(s,event); s.rev=randomUUID(); s.phase='reviewing'; put(s); return {s,rule};
  });
  if (!begin) return {};
  if (begin.failure) return begin.failure;
  const {s,rule}=begin;
  try {
    const recorded=events(dir,s);
    const rows=[...new Map(recorded.map(r=>[r.id,r])).values()];
    if (answer) rows.push({ id:'r'+s.round+':answer', type:'agentMessage', detail:answer });
    const packet={ ...common(s), sentPrompt:s.instruction, finalGoalCheck:s.index === s.tasks.length-1,
      ...(rule?.revision ? {taskReviewRule:rule} : {}),
      instruction:'On the last item verify the whole original goal, including anything omitted from the plan. Tool status alone cannot prove file contents. For implementation work require observable evidence, not a statement of completion.',
      evidence:budgetEvidence(rows,65000) };
    log(dir,s,'review-input',packet);
    let verdict=decision(await reply('review',packet),packet.evidence,{status:'completed'});
    if (verdict.verdict==='pass' && s.tasks[s.index].proof==='tool') {
      const substantiated=rows.some(row=>{
        if (row.type!=='toolStatus' || !verdict.evidence.includes(row.id) || Number(row.id.slice(1).split(':')[0]) < s.firstRound) return false;
        const info=JSON.parse(row.detail);
        return info.exitCode!==undefined ? info.exitCode===0 :
          info.isError===false || info.success===true || info.status==='completed';
      });
      if (!substantiated) verdict={verdict:'revise',reason:'实际执行缺少可引用的成功结果。',gaps:['核对当前任务的实际产物，取得成功的工具结果。'],evidence:[],nextPrompt:'在原权限范围内进行一个能核对本项产物的检查。如果无法核实，说明具体阻碍。'};
    }
    s.history.push({ round:s.round, task:s.index, ...verdict });
    let next;
    if (verdict.verdict === 'revise') next=checkedPrompt(s,verdict.nextPrompt,verdict.gaps);
    if (verdict.verdict === 'pass' && s.index < s.tasks.length-1) {
      s.index++;
      s.firstRound=s.round+1;
      next=checkedPrompt(s,(await reply('brief',common(s))).prompt);
    }
    return update(dir,(cur,put) => {
      if (cur.rev !== s.rev) return {};
      log(dir,s,'review',verdict);
      if (next) {
        s.round++; s.instruction=next; s.next=next; s.phase='continuing'; log(dir,s,'prompt',{instruction:next});
        put(s); return { decision:'block',reason:next };
      }
      s.phase=verdict.verdict==='pass'?'done':'blocked'; put(s);
      return warning((s.phase==='done'?'审查通过。':'等待补充。')+verdict.reason);
    });
  } catch (err) {
    return update(dir,(cur,put) => {
      if (cur.rev !== s.rev) return {};
      s.phase='error'; put(s);
      return warning('本轮尚未通过审查。'+err.message);
    });
  }
}
