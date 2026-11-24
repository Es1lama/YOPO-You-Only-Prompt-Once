import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hash, json, read, save } from './storage.js';
import { userDir, savedProvider, verifyAndSaveProvider } from './provider.js';
import { envConnection } from './gemini.js';
import { promptConnection } from './setup-provider.js';
import { connect } from './codex.js';
import { terminal } from './try.js';

export const eventNames = ['UserPromptSubmit','PostToolUse','Stop','Interrupt'];
const root = fileURLToPath(new URL('../',import.meta.url));
const sources = ['package.json','bin/codex-hook.js','src/native.js','src/native-state.js','src/provider.js','src/gemini.js',
  'src/loop.js','src/evidence.js','src/codex.js','src/storage.js','src/services.js','prompts/reviewer.md'];
const codexDir = () => process.env.CODEX_HOME || path.join(os.homedir(),'.codex');
function readHooks(file) {
  if (!fs.existsSync(file)) return { hooks:{} };
  const doc=JSON.parse(read(file).replace(/^\uFEFF/,''));
  if (!doc || typeof doc!=='object' || Array.isArray(doc)) throw Error('Invalid hooks.json');
  doc.hooks ??= {};
  if (typeof doc.hooks!=='object' || Array.isArray(doc.hooks)) throw Error('Invalid hooks table');
  return doc;
}
function runtime(home) {
  const digest=hash(sources.map(f=>f+'\n'+hash(fs.readFileSync(path.join(root,f)))).join('\n')).slice(0,20);
  const dest=path.join(home,'runtime',digest);
  fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});
  if (!fs.existsSync(dest)) {
    const tmp=dest+'-'+randomUUID();
    fs.mkdirSync(tmp,{mode:0o700});
    for (const src of sources) {
      const target=path.join(tmp,src);
      fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
      fs.copyFileSync(path.join(root,src),target);
    }
    fs.renameSync(tmp,dest);
  }
  for (const src of sources) if (hash(fs.readFileSync(path.join(dest,src)))!==hash(fs.readFileSync(path.join(root,src)))) throw Error('Installed runtime has changed: '+src);
  return path.join(dest,'bin','codex-hook.js');
}
// Most paths can be displayed literally in /hooks. Encode unusual shell characters without interpolation.
function hookCommand(file) {
  const normalized=file.replaceAll('\\','/');
  if (/^[\p{L}\p{N}_:./ ()-]+$/u.test(normalized)) return 'node "'+normalized+'"';
  const encoded=Buffer.from(file).toString('base64');
  return 'node -e "import(require(\'node:url\').pathToFileURL(Buffer.from(\''+encoded+'\',\'base64\').toString()).href)"';
}

export function install({ home=userDir(), codex=codexDir(), remove=false }={}) {
  const file=path.join(codex,'hooks.json'), receipt=path.join(home,'installed.json');
  fs.mkdirSync(home,{recursive:true,mode:0o700});
  fs.mkdirSync(codex,{recursive:true,mode:0o700});
  const prior=fs.existsSync(receipt)?json(receipt).commands?.[path.resolve(file)]:undefined;
  if (remove && !prior) return {file,changed:false};
  const newCommand=remove?null:hookCommand(runtime(home));
  if (!remove && !fs.existsSync(path.join(home,'reviewer.md'))) fs.copyFileSync(new URL('../prompts/reviewer.md',import.meta.url),path.join(home,'reviewer.md'));
  const before=fs.existsSync(file)?read(file):null;
  const doc=readHooks(file);
  const previous=JSON.stringify(doc);
  for (const name of eventNames) {
    const groups=doc.hooks[name] ?? [];
    const kept=[];
    let found=false;
    const definition={type:'command',command:newCommand,timeout:name==='Interrupt'?3:300,statusMessage:'Yo-po · '+name};
    for (const group of groups) {
      const handlers=[];
      for (const h of group.hooks) {
        if (h.type!=='command' || !(h.command===prior || (newCommand && h.command===newCommand))) handlers.push(h);
        else if (newCommand && !found) { handlers.push({...h,...definition}); found=true; }
      }
      if (handlers.length || !group.hooks.length) kept.push({...group,hooks:handlers});
    }
    if (newCommand && !found) kept.push({hooks:[definition]});
    if (kept.length) doc.hooks[name]=kept; else delete doc.hooks[name];
  }
  const changed=JSON.stringify(doc)!==previous;
  if (changed) {
    if ((fs.existsSync(file)?read(file):null)!==before) throw Error('hooks.json changed concurrently. Run installation again.');
    if (before!==null) fs.copyFileSync(file,path.join(home,'hooks-backup-'+randomUUID()+'.json'));
    save(file,doc);
  }
  const records=fs.existsSync(receipt)?json(receipt):{commands:{}};
  if (remove) delete records.commands[path.resolve(file)]; else records.commands[path.resolve(file)]=newCommand;
  if (remove || prior!==newCommand) save(receipt,records);
  return {file,changed,events:eventNames};
}

function registered(home, codex) {
  const file = path.resolve(codex, 'hooks.json');
  const receipt = path.join(home,'installed.json');
  const command = fs.existsSync(receipt) && json(receipt).commands?.[file];
  const hooks = readHooks(file).hooks;
  const events = eventNames.filter(n=>command && hooks[n]?.some(g=>g.hooks.some(h=>h.type==='command' && h.command===command)));
  return {file,command,events};
}

export async function hookStatus({home=userDir(), codex=codexDir(), env=process.env, cwd=process.cwd()}={}) {
  const {file, command, events} = registered(home,codex);
  const saved = savedProvider(home);
  const session = envConnection(env);
  const status = {file,events,providerConfigured:!!(saved || (session.model && session.key)),saved,state:'unregistered'};
  if (events.length !== eventNames.length) return status;
  const rpc = connect({...env,CODEX_HOME:codex});
  const timer = setTimeout(()=>rpc.close(),8000);
  try {
    await rpc.initialize();
    const {data} = await rpc.call('hooks/list',{cwds:[cwd]});
    const ours = (data[0]?.hooks ?? []).filter(h=>h.command===command && path.relative(file,h.sourcePath)==='');
    const all = eventNames.every(n=>ours.some(h=>h.eventName===n[0].toLowerCase()+n.slice(1)));
    if (!all) status.state = 'unavailable';
    else if (ours.some(h=>!h.enabled)) status.state = 'disabled';
    else if (ours.every(h=>['trusted','managed'].includes(h.trustStatus))) status.state = 'ready';
    else status.state = 'needs-trust';
  } catch { status.state = 'unknown'; }
  finally { clearTimeout(timer); rpc.close(); }
  return status;
}

export async function nativeCommand(command, {print=console.log, input=terminal, signal}={}) {
  const home = userDir();
  if (command==='hook-status') {
    print(JSON.stringify(await hookStatus(),null,2));
    return;
  }
  if (command==='uninstall-hooks') {
    print('已移除当前用户的 Yo-po Hooks。',install({remove:true}).file);
    return;
  }
  if (command==='configure-api' || (command==='setup' && !savedProvider(home))) {
    print('选择谁来检查 Codex 的工作。接好一次，以后这套 Codex 的每个项目和聊天都会自动使用它。审查模型会收到去敏的任务文本、回复摘录和工具执行状态。');
    const io = input();
    try {
      const config = await promptConnection(io.ask,print,undefined,signal);
      if (!config) { print('已退出设置。'); return; }
      print('正在用一句测试消息检查这个模型能否按要求回答……');
      await verifyAndSaveProvider(home,config,fetch,signal);
    } finally { io.close(); }
  }
  install();
  const status = await hookStatus();
  if (status.saved) print('已保存审查模型 '+status.saved.model+'（'+status.saved.base+'）。');
  else if (!status.providerConfigured) print('运行 npm start 连接你要用的审查模型。');
  if (status.state==='ready') {
    if (status.providerConfigured) print('Codex 已启用自动审查。以后照常打开 Codex，在任何使用这套配置的项目里直接发任务。');
  } else if (status.state==='needs-trust') {
    print('还差一步：在 Codex CLI 输入 /hooks，检查并信任 Yo-po 的四项，然后重新打开 Codex。以后直接聊天即可。');
  } else if (status.state==='disabled') {
    print('Codex 报告部分 Yo-po Hooks 已停用。在 Codex 的 /hooks 可查看并启用。');
  } else {
    print('已写入 '+status.file+'。暂未确认 Codex 已加载。请用支持 Hooks 的 Codex CLI 输入 /hooks 查看。');
  }
  if (status.saved) print('以后要换平台、模型或密钥：双击「更换审查接口.cmd」，或在项目目录运行 npm run configure。');
}
