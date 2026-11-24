#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { init, json, note, read } from '../src/storage.js';
import { run, interruptRecord } from '../src/loop.js';
import { connect } from '../src/codex.js';
import { envConnection } from '../src/gemini.js';
import { savedProvider, reviewer, userDir } from '../src/provider.js';

const help = [
  'Yo-po — You Only Prompt Once',
  'yo-po setup | configure-api | install-hooks | uninstall-hooks | hook-status',
  'yo-po review-chat | review-chat-demo  (Windows)',
  'yo-po try',
  'yo-po init RUN_DIR --workspace PATH (--goal TEXT | --goal-file FILE) [--todos FILE.json] [--artifact PATH ...]',
  'yo-po run RUN_DIR [--prepare] [--rounds N]',
  'yo-po note RUN_DIR "additional user feedback"',
  'yo-po status RUN_DIR',
  'yo-po interrupt-record RUN_DIR "observed reason the worker stopped"',
  'yo-po doctor'
].join('\n');

async function main(args) {
  if (!args.length || args.includes('--help')) { console.log(help); return; }
  const [command, raw, ...rest] = args;
  if (command==='review-chat' || command==='review-chat-demo') {
    if (raw!==undefined) throw Error(help);
    if (command==='review-chat-demo') await (await import('../examples/review-chat-demo.js')).runReviewDemo();
    else await (await import('../src/windows-review-chat.js')).windowsReviewChat();
    return;
  }
  if (['setup','configure-api'].includes(command) && raw==='--window') {
    const { windowsSetup } = await import('../src/windows-setup.js');
    await windowsSetup(command);
    return;
  }
  if (['setup','configure-api','install-hooks','uninstall-hooks','hook-status'].includes(command)) {
    const { nativeCommand } = await import('../src/install-hooks.js');
    await nativeCommand(command);
    return;
  }
  if (command === 'try') {
    const { start } = await import('../src/try.js');
    await start();
    return;
  }
  if (command === 'doctor') {
    const rpc = connect();
    try {
      const info = await rpc.initialize();
      console.log('Codex app-server handshake OK: ' + (info.userAgent || 'initialized'));
      const saved = savedProvider(userDir()), env = envConnection();
      console.log('审查模型：' + (saved?.model || (env.key && env.model) || '尚未配置'));
    } finally { rpc.close(); }
    return;
  }
  if (!raw) throw Error(help);
  const dir = path.resolve(raw);
  if (command === 'init') {
    const { values: v } = parseArgs({ args: rest, options: {
      workspace: { type: 'string' }, goal: { type: 'string' }, 'goal-file': { type: 'string' },
      todos: { type: 'string' }, artifact: { type: 'string', multiple: true, default: [] }
    } });
    if (!v.workspace || (!!v.goal === !!v['goal-file'])) throw Error(help);
    init(dir, v.workspace, v.goal ?? read(v['goal-file']), v.todos ? json(v.todos) : [], v.artifact);
    console.log('Initialized ' + dir);
  } else if (command === 'run') {
    const { values: v } = parseArgs({ args: rest, options: { rounds: { type: 'string' }, prepare: { type: 'boolean' } } });
    let client;
    const ask = (...input) => (client ??= reviewer(userDir()))(...input);
    const s = await run(dir, { ask, prepare: v.prepare, limit: v.rounds === undefined ? Infinity : Number(v.rounds) });
    console.log('Status: ' + s.phase);
    if (s.phase === 'blocked') process.exitCode = 2;
  } else if (command === 'note' || command === 'interrupt-record') {
    if (!rest.length) throw Error(help);
    const message = rest.join(' ');
    if (command === 'note') note(dir, message); else interruptRecord(dir, message);
    console.log('Recorded.');
  } else if (command === 'status') {
    if (rest.length) throw Error(help);
    const s = json(path.join(dir, 'state.json'));
    const next = s.items[s.index];
    console.log(JSON.stringify({ goal: s.goal, phase: s.phase, current: next?.title, round: s.round, thread: s.threadId, lastReview: s.history.at(-1), locked: fs.existsSync(path.join(dir, 'run.lock')) }, null, 2));
  } else throw Error(help);
}
main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exitCode = 1; });
