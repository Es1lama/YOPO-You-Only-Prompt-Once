import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createReviewDesk } from './review-chat.js';
import { savedProvider, userDir } from './provider.js';
import { envConnection } from './gemini.js';

function modelLabel(home) {
  try {
    const saved=savedProvider(home), env=envConnection(), cfg=saved || (env.key && env.model ? env : null);
    if (!cfg) return '尚未配置审查接口';
    return cfg.model+' · '+(cfg.base?new URL(cfg.base).host:'generativelanguage.googleapis.com');
  } catch { return '审查接口配置无法读取'; }
}

export function createReviewChannel({home=userDir(),ask,onDemoReview}={}) {
  const desk=createReviewDesk({home,ask});
  return {
    close(){desk.select(null);},
    async request(frame) {
      const {type,target,view}=frame;
      try {
        switch(type) {
          case 'list': return {type:'tasks',tasks:desk.list(),model:modelLabel(home),demo:!!onDemoReview};
          case 'select': return {type:'selected',view,...desk.select(target)};
          case 'message': return {type:'reply',view,...await desk.send(target,frame.text,frame.mode)};
          case 'apply': return {type:'applied',view,...desk.apply(target,frame.text)};
          case 'demoStop':
            if (onDemoReview) return {type:'demoResult',view,text:await onDemoReview(target)};
            break;
        }
        throw Error('未知的窗口操作。');
      } catch (e) {
        const message=e instanceof SyntaxError ? '本地数据格式异常，无法继续。' : e.message;
        return {type:'error',view,operation:type,code:e.code || '',text:message};
      }
    }
  };
}

export async function windowsReviewChat(options={}) {
  if (process.platform!=='win32') throw Error('审查对话窗口需要 Windows。');
  const channel=createReviewChannel(options);
  const executable=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  // PowerShell 5.1 treats BOM-less -File as ANSI. Load this trusted app script explicitly as UTF-8.
  const runner='. ([ScriptBlock]::Create([IO.File]::ReadAllText($env:YOPO_CHAT_WINDOW_SCRIPT,[Text.Encoding]::UTF8))); Start-ReviewChatWindow';
  const child=spawn(executable,['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(runner,'utf16le').toString('base64')],{
    env:{...process.env,YOPO_CHAT_WINDOW_SCRIPT:fileURLToPath(new URL('../windows/review-chat.ps1',import.meta.url))},
    // On Windows, libuv's windowsHide can leave even the first WinForms window hidden.
    // Host all console I/O over pipes, but allow the GUI process to show its form.
    windowsHide:false,stdio:['pipe','pipe','pipe']
  });
  const lines=createInterface({input:child.stdout});let closing=false, ready=false, timedOut=false;
  const startup=setTimeout(()=>{
    if (!ready && !closing) {timedOut=true;child.kill();}
  },15000);
  const send=frame=>{if (!closing && !child.stdin.destroyed) child.stdin.write(JSON.stringify(frame)+'\n');};
  lines.on('line',line=>{
    let frame;
    try { frame=JSON.parse(line); } catch {return;}
    if (frame.type==='list') {ready=true;clearTimeout(startup);}
    channel.request(frame).then(send).catch(()=>send({type:'error',view:frame.view,text:'无法完成窗口操作。'}));
  });
  child.stdin.on('error',()=>{closing=true;channel.close();});child.stderr.resume();
  try {
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    if (timedOut) throw Error('审查对话窗口启动超时。请确认 Windows PowerShell 可用后重试。');
    if (code!==0 || !ready) throw Error('无法打开审查对话窗口。请在有桌面的 Windows 上运行，并确认 Windows PowerShell 可用。');
  } finally {clearTimeout(startup);closing=true;channel.close();lines.close();child.stdin.end();}
}
