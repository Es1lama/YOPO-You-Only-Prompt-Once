import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { nativeCommand } from './install-hooks.js';

// The CLI and the window share their installer. Only prompts and responses cross these pipes.
export async function windowsSetup(command) {
  if (process.platform!=='win32') throw Error('请在当前平台的终端运行 npm start。');
  const script=fs.readFileSync(new URL('../windows/setup.ps1',import.meta.url),'utf8');
  const executable=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child=spawn(executable,['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
    stdio:['pipe','pipe','pipe'], windowsHide:false
  });
  child.stderr.resume();
  const stopped=new AbortController();
  const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
  const closed=new Promise(resolve=>{
    child.on('error',()=>{ stopped.abort(); resolve(-1); });
    child.on('close',code=>{ stopped.abort(); resolve(code); });
  });
  child.stdin.on('error',()=>stopped.abort());
  const send=frame=>{if (!stopped.signal.aborted) child.stdin.write(JSON.stringify(frame)+'\n');};
  async function answer() {
    const next=await lines.next();
    if (next.done) return;
    return JSON.parse(next.value);
  }
  const print=(...parts)=>send({type:'print',text:parts.join(' ')});
  const ask=async (text,secret=false)=>{
    send({type:'ask',text,secret});
    const frame=await answer();
    if (frame?.type!=='answer' || typeof frame.value!=='string') throw Error('设置窗口已关闭。');
    return frame.value.trim();
  };
  try {
    if ((await answer())?.type!=='ready') throw Error('无法打开 Windows 设置窗口。');
    for (;;) {
      try { await nativeCommand(command,{print,input:()=>({ask,close(){}}),signal:stopped.signal}); }
      catch (err) { if (!stopped.signal.aborted) print(err.message); }
      if (stopped.signal.aborted) break;
      send({type:'finish'});
      if ((await answer())?.type!=='again') break;
      command='configure-api';
      send({type:'reset'});
    }
  } finally {
    child.stdin.end();
    if ((await closed)!==0) throw Error('Windows 设置窗口异常退出。');
  }
}
