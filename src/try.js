import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { connect } from './codex.js';
import { endpoint, envConnection, gemini, listModels, reviewClient } from './gemini.js';
import { reviewer, savedProvider, userDir } from './provider.js';
import { promptConnection } from './setup-provider.js';
import { init, json, note, roundDir } from './storage.js';
import { run } from './loop.js';
import { demo } from '../examples/demo.js';

export function terminal() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('设置窗口未连接到交互终端，无法安全输入密钥。请关闭此窗口，在 Windows 双击 Yo-po.cmd，或在终端直接运行 npm start。');
  let muted = false;
  const out = new Writable({ write(chunk, _encoding, next) {
    if (!muted) process.stdout.write(chunk);
    next();
  } });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true, historySize: 0 });
  const stop = new AbortController();
  rl.on('close', () => stop.abort());
  rl.on('SIGINT', () => rl.close());
  return {
    async ask(label, secret = false) {
      if (secret) process.stdout.write(label);
      muted = secret;
      try { return (await rl.question(secret ? '' : label, { signal: stop.signal })).trim(); }
      finally { muted = false; if (secret) process.stdout.write('\n'); }
    },
    close: () => rl.close()
  };
}

async function readyCodex() {
  const rpc = connect();
  try { await rpc.initialize(); } finally { rpc.close(); }
}

export async function configure(env, ask, print, getModels = listModels) {
  const target = endpoint(env);
  print('Gemini 接口：' + target);
  if (!env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) {
    if (new URL(target).origin !== 'https://generativelanguage.googleapis.com') {
      throw Error('自定义服务请先为该服务设置 GEMINI_API_KEY。');
    }
    print('从 Google AI Studio 获取自己的 Gemini API 密钥：https://aistudio.google.com/apikey');
    const key = await ask('在本机粘贴密钥后回车（隐藏输入，仅本次使用；直接回车退出）：', true);
    if (!key) return false;
    env.GEMINI_API_KEY = key;
  }
  if (env.GEMINI_MODEL) { print('Gemini 模型：' + env.GEMINI_MODEL); return true; }
  const choices = (await getModels(env)).filter(m => !/(?:image|tts|audio|robotics|computer-use|embedding|video|deep-research)/i.test(m));
  if (!choices.length) throw Error('该账号没有列出可选的文本生成模型。若服务已提供模型 ID，可设置 GEMINI_MODEL。');
  print('请选择你账号可用的文本模型：\n' + choices.map((m, i) => (i + 1) + '. ' + m).join('\n'));
  while (true) {
    const selected = await ask('模型编号（直接回车退出）：');
    if (!selected) return false;
    const i = Number(selected) - 1;
    if (Number.isInteger(i) && choices[i]) { env.GEMINI_MODEL = choices[i]; return true; }
    print('请输入列表里的编号。');
  }
}

function location(value) { return path.resolve(value.replace(/^"(.*)"$/, '$1')); }

export async function tryProject({ ask, print = console.log, env = { ...process.env },
  home = path.join(os.homedir(), 'Yo-po-runs'), providerDir = userDir(), check = readyCodex, getModels, runTask = run } = {}) {
  print('Yo-po — You Only Prompt Once\n\n1  真实模型 · 输入自己的任务\n2  继续已有真实任务\n3  离线示例 · 看一次遗漏怎样被退回\n0  退出');
  let choice;
  do { choice = (await ask('选择 [1]：')) || '1'; } while (!['0','1','2','3'].includes(choice));
  if (choice === '0') return;
  if (choice === '3') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yo-po-demo-'));
    print('离线示例 · 执行与审查均由固定脚本模拟。');
    const result = await demo(root, print);
    print('打开产物：' + result.workspace + '\n逐轮记录：' + result.dir);
    return;
  }

  let dir;
  if (choice === '2') {
    const entered = await ask('已有运行目录（含 state.json）：');
    if (!entered) return;
    dir = location(entered);
  } else {
    const mark = randomBytes(3).toString('hex');
    const sample = '创建 hello.txt，内容为 Yo-po ' + mark + '，允许末尾换行。实际读回文件并核对。';
    print('可以自己出题，也可以用这道带随机标记的题：\n' + sample);
    const own = await ask('你的任务（回车采用上面的题目）：');
    const files = own ? await ask('要验收的相对文件名（可留空，多个用 | 分隔）：') : 'hello.txt';
    fs.mkdirSync(home, { recursive: true });
    const root = fs.mkdtempSync(path.join(home, 'trial-'));
    const workspace = path.join(root, 'work');
    fs.mkdirSync(workspace);
    dir = path.join(root, 'run');
    init(dir, workspace, own || sample, [], files.split('|').map(s => s.trim()).filter(Boolean));
  }
  const state = json(path.join(dir, 'state.json'));
  print('原始目标：' + state.goal + '\n产物目录：' + state.workspace + '\n运行记录：' + dir);
  if (choice === '2' && ['done','blocked'].includes(state.phase)) {
    print('上次审查：' + state.history.at(-1).reason);
    const more = await ask('输入新的意见以继续，或直接回车退出：');
    if (!more) return;
    note(dir, more);
  }
  print('真实模式会把任务、选定的运行记录和文件摘录交给你选的审查模型，Codex 在上述工作目录执行。');
  await check();
  let client;
  const supplied = envConnection(env);
  if (savedProvider(providerDir)) client = reviewer(providerDir);
  else if (supplied.key && supplied.model) client = reviewClient(supplied);
  else if (supplied.format==='gemini' && (supplied.key || supplied.base || supplied.model)) {
    if (await configure(env,ask,print,getModels)) client = gemini(env);
  } else {
    const cfg = await promptConnection(ask,print,getModels);
    if (cfg) client = reviewClient(cfg);
  }
  if (!client) { print('进度已保存在运行记录中。'); return; }
  let mode;
  do { mode = (await ask('回车自动跑到审查结束，输入 s 逐轮检查，输入 q 退出：')).toLowerCase(); }
  while (!['','s','q'].includes(mode));
  if (mode === 'q') return;
  for (;;) {
    const s = await runTask(dir, { ask: client, limit: mode === 's' ? 1 : Infinity, print });
    if (s.round) print('最近一轮的完整指令与审查记录：' + roundDir(dir, s.round));
    if (s.phase === 'done') {
      print('模型审查已通过。请打开 ' + state.workspace + ' 对照你的原始要求，亲自验收产物。');
      return;
    }
    if (s.phase === 'blocked') print('任务等待补充：' + s.history.at(-1).reason);
    const feedback = await ask('输入补充意见后回车，直接回车继续，或输入 /quit 保存退出：');
    if (feedback === '/quit' || (!feedback && s.phase === 'blocked')) return;
    if (feedback) note(dir, feedback);
  }
}

export async function start() {
  const io = terminal();
  try { await tryProject({ ask: io.ask }); }
  finally { io.close(); }
}
