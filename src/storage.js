import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';

export const read = file => fs.readFileSync(file, 'utf8');
export const json = file => JSON.parse(read(file));
export const hash = data => createHash('sha256').update(data).digest('hex');
export function write(file, data) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(tmp, data, { flag: 'wx', mode: 0o600 });
  try { fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}
export const save = (file, value) => write(file, JSON.stringify(value, null, 2) + '\n');
export function inside(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
}
export function settings(dir) {
  const notes = fs.readdirSync(path.join(dir, 'feedback')).filter(n => n.endsWith('.txt')).sort();
  const feedback = notes.map(n => read(path.join(dir, 'feedback', n)));
  const system = read(path.join(dir, 'reviewer.md'));
  return { system, feedback, revision: hash(JSON.stringify([system, feedback])) };
}
export function note(dir, message) {
  if (!message.trim()) throw Error('Feedback must contain text.');
  write(path.join(dir, 'feedback', Date.now() + '-' + randomUUID() + '.txt'), message);
}
export const roundDir = (dir, n) => path.join(dir, 'rounds', String(n).padStart(4, '0'));

export function acquire(dir) {
  const file = path.join(dir, 'run.lock');
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch (err) {
    if (err.code !== 'EEXIST') throw err;
    throw Error('Run is locked. Check run.lock and the owning process before removing an abandoned lock.');
  }
  fs.writeFileSync(fd, JSON.stringify({ host: os.hostname(), pid: process.pid }));
  fs.closeSync(fd);
  return () => fs.rmSync(file, { force: true });
}

export function init(dir, workspace, goal, todos = [], artifacts = []) {
  if (!goal.trim()) throw Error('Supply a nonempty goal.');
  if (![todos, artifacts].every(list => Array.isArray(list) && list.every(x => typeof x === 'string' && x.trim()))) {
    throw Error('TODOs and artifacts must be nonempty strings.');
  }
  workspace = fs.realpathSync(workspace);
  if (!fs.statSync(workspace).isDirectory()) throw Error('Workspace must be a directory.');
  const parent = fs.realpathSync(path.dirname(path.resolve(dir)));
  dir = path.join(parent, path.basename(path.resolve(dir)));
  if (inside(workspace, dir) || inside(dir, workspace)) throw Error('Use separate workspace and run directories.');
  if (artifacts.some(a => path.isAbsolute(a) || !inside(workspace, path.resolve(workspace, a)))) {
    throw Error('Artifact must be a relative path within the workspace.');
  }
  fs.mkdirSync(dir, { mode: 0o700 });
  for (const sub of ['feedback', 'rounds']) fs.mkdirSync(path.join(dir, sub));
  fs.copyFileSync(new URL('../prompts/reviewer.md', import.meta.url), path.join(dir, 'reviewer.md'));
  const state = { version: 1, workspace, goal, todos, artifacts, items: [], index: 0, round: 0, history: [], phase: 'planning' };
  save(path.join(dir, 'state.json'), state);
  return state;
}
