// A scripted demonstration; no model or network access.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../src/storage.js';
import { run } from '../src/loop.js';

export async function demo(root, print = console.log) {
  const workspace = path.join(root, 'work');
  const dir = path.join(root, 'run');
  fs.mkdirSync(workspace);
  init(dir, workspace, 'Deliver greeting.txt containing Hello and a usage note in README.md.',
    ['Write greeting.txt', 'Write the usage note'], ['greeting.txt', 'README.md']);
  let count = 0;
  async function worker({ record, onThread, prompt }) {
    onThread('scripted-demo');
    const n = ++count;
    record({ type: 'start', turnId: 'turn-' + n });
    if (n === 2) fs.writeFileSync(path.join(workspace, 'greeting.txt'), 'Hello\n');
    if (n === 3) fs.writeFileSync(path.join(workspace, 'README.md'), 'Read greeting.txt to see the greeting.\n');
    record({ type: 'item', item: { type: 'agentMessage', text: n === 1 ? 'I finished the greeting.' : 'Completed: ' + prompt.split('\n').at(-1) } });
    record({ type: 'end', status: 'completed' });
  }
  async function ask(kind, _system, data) {
    if (kind === 'brief') return { prompt: 'Carry out and verify: ' + data.currentTask.acceptance };
    const snapshots = data.evidence.filter(e => e.id.startsWith('r' + count + ':a')).map(e => ({ id: e.id, ...JSON.parse(e.detail) }));
    const greeting = snapshots.find(a => a.name === 'greeting.txt' && a.content?.trim() === 'Hello');
    const usage = snapshots.find(a => a.name === 'README.md' && a.content?.includes('greeting.txt'));
    if (!greeting) return { verdict: 'revise', reason: 'The claimed greeting file is absent.', gaps: ['greeting.txt must exist and contain Hello.'], evidence: [snapshots[0].id], nextPrompt: 'Create greeting.txt with Hello, then verify its contents.' };
    if ((data.currentTask.final || data.currentTask.title.includes('usage')) && !usage) throw Error('Expected a usage note.');
    return { verdict: 'pass', reason: 'The captured file contents meet the task.', gaps: [], evidence: [greeting, usage].filter(Boolean).map(a => a.id), nextPrompt: '' };
  }
  const state = await run(dir, { ask, worker, print });
  return { dir, workspace, state };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yo-po-demo-'));
  const { state, dir } = await demo(root);
  console.log('Offline demo: ' + state.phase + '. Inspect prompts, evidence and reviews at ' + dir);
}
