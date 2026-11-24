import fs from 'node:fs';
import path from 'node:path';
import { json, save } from './storage.js';

// Only synchronous, short file transactions are allowed in this lock.
export function update(dir, fn) {
  fs.mkdirSync(dir, { recursive:true, mode:0o700 });
  const lock=path.join(dir,'state.lock'), file=path.join(dir,'active.json'), until=Date.now()+5000;
  let fd;
  while (fd===undefined) {
    try { fd=fs.openSync(lock,'wx',0o600); }
    catch (e) {
      if (e.code!=='EEXIST' || Date.now()>=until) throw Error('会话状态正在使用。若异常退出，请检查 '+lock);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15);
    }
  }
  try { return fn(fs.existsSync(file)?json(file):null,state=>save(file,state)); }
  finally { fs.closeSync(fd); fs.rmSync(lock,{force:true}); }
}

export const validSession = key=>typeof key==='string' && /^[0-9a-f]{64}$/.test(key);
const validRun = run=>typeof run==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(run);
export const available = s=>s?.reviewChatVersion===1 && !s.disabled && validRun(s.run) &&
  typeof s.goal==='string' && !!s.goal.trim() && ['planning','running','continuing','reviewing'].includes(s.phase);
const stat = f=>fs.lstatSync(f,{throwIfNoEntry:false});
export const realDir = f=>!!stat(f)?.isDirectory();
export const realFile = f=>!!stat(f)?.isFile();
export const stale = ()=>Object.assign(Error('任务已结束、已暂停或已被替换。请刷新并重新选择。'),{code:'STALE_TASK'});

// A task handle is never a user-supplied file path. Recheck the active UUID under the hook's own lock.
export function withTarget(home,target,fn) {
  if (!validSession(target?.session) || !validRun(target?.run)) throw stale();
  const root=path.join(home,'sessions'), dir=path.join(root,target.session);
  if (!realDir(root) || !realDir(dir) || !realFile(path.join(dir,'active.json'))) throw stale();
  return update(dir,s=>{
    if (!available(s) || s.run!==target.run) throw stale();
    return fn(dir,s);
  });
}

const ruleFile=(dir,s)=>{
  if (!validRun(s.run)) throw stale();
  const runDir=path.join(dir,s.run), dirStat=stat(runDir);
  if (dirStat && !dirStat.isDirectory()) throw Error('任务规则目录异常，已停止读取。');
  return path.join(runDir,'review-rule.json');
};
export const ruleLimit=2000;
export function readRule(dir,s) {
  const file=ruleFile(dir,s), fstat=stat(file);
  if (!fstat) return {revision:0,text:''};
  if (!fstat.isFile() || fstat.size>20000) throw Error('本任务规则文件异常，未使用。');
  let row;
  try { row=json(file); } catch { throw Error('本任务规则文件异常，未使用。'); }
  if (!row || !Number.isSafeInteger(row.revision) || row.revision<1 || typeof row.text!=='string' ||
      !row.text.trim() || row.text.length>ruleLimit) throw Error('本任务规则文件异常，未使用。');
  return {revision:row.revision,text:row.text};
}
export function writeRule(dir,s,text,expected) {
  const previous=readRule(dir,s);
  if (previous.revision!==expected) throw Object.assign(Error('其他窗口已更新本任务的规则。请先复制你的草案，重新选择任务，再决定是否替换。'),{code:'RULE_CONFLICT'});
  if (previous.text===text) return previous;
  const file=ruleFile(dir,s), row={revision:previous.revision+1,text};
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  save(file,row);
  return row;
}
