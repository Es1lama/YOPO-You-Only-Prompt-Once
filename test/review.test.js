import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { demo } from '../examples/demo.js';
import { init, json, note, read, roundDir, acquire } from '../src/storage.js';
import { run, interruptRecord } from '../src/loop.js';
import { artifacts, budgetEvidence, redact } from '../src/evidence.js';
import { execute } from '../src/codex.js';
import { gemini } from '../src/gemini.js';

const silent = () => {};
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yo-po-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function caseDir(t, todos = ['Do the task']) {
  const root = temp(t), workspace = path.join(root, 'work'), dir = path.join(root, 'run');
  fs.mkdirSync(workspace);
  init(dir, workspace, 'Deliver a verified result.', todos);
  return { dir, workspace };
}
const pass = data => ({ verdict: 'pass', reason: 'Verified check output.', gaps: [],
  evidence: [data.evidence.findLast(row => row.type === 'commandExecution').id], nextPrompt: '' });
const ordinary = async (kind, system, data) => {
  if (kind === 'plan') return { tasks: [{ title: 'Implement', acceptance: 'Tests pass' }] };
  if (kind === 'brief') return { prompt: 'Execute task: ' + data.currentTask.title + '. ' + data.userFeedback.join(' ') };
  return pass(data);
};
async function worker({ onThread, record }) {
  onThread('fixture-1');
  record({ type: 'item', item: { type: 'commandExecution', exitCode: 0, aggregatedOutput: '1 passed' } });
  record({ type: 'end', status: 'completed' });
}
const opts = { worker, ask: ordinary, print: silent };

test('false completion returns all gaps, fixes the same item, then unlocks the next task', async t => {
  const { state, dir } = await demo(temp(t), silent);
  assert.equal(state.phase, 'done');
  assert.deepEqual(state.history.map(h => [h.index, h.verdict]), [[0,'revise'],[0,'pass'],[1,'pass'],[2,'pass']]);
  assert.match(read(path.join(roundDir(dir, 2), 'sent-prompt.md')), /greeting.txt must exist/);
  assert.ok(json(path.join(roundDir(dir, 4), 'review-input.json')).evidence.some(r => r.id === 'r1:a1'));
});
test('prepare supports editing the exact instruction and later feedback invalidates stale preparation', async t => {
  const { dir } = caseDir(t, []);
  assert.equal((await run(dir, { ...opts, prepare: true })).phase, 'ready');
  const instruction = path.join(roundDir(dir, 1), 'instruction.md');
  fs.writeFileSync(instruction, 'stale');
  note(dir, 'Prefer a short result.');
  await run(dir, { ...opts, prepare: true });
  assert.match(read(instruction), /Prefer a short result/);
  fs.writeFileSync(instruction, 'User-edited full instruction.');
  const result = await run(dir, { ...opts, limit: 1 });
  assert.equal(result.phase, 'briefing');
  assert.equal(result.round, 1);
  const sent = read(path.join(roundDir(dir, 1), 'sent-prompt.md'));
  assert.match(sent, /User-edited full instruction/);
  assert.match(sent, /Prefer a short result/);
});
test('Gemini failure or invented evidence cannot advance or replay the completed worker turn', async t => {
  const { dir } = caseDir(t);
  let count = 0;
  const w = async o => { count++; return worker(o); };
  for (const answer of [() => { throw Error('upstream down'); }, d => ({ ...pass(d), evidence: ['r44:e55'] }), d => ({ ...pass(d), evidence: [d.evidence.at(-1).id] })]) {
    const ask = (kind, s, d) => kind === 'review' ? answer(d) : ordinary(kind, s, d);
    await assert.rejects(run(dir, { ask, worker: w, print: silent }));
    assert.equal(json(path.join(dir, 'state.json')).phase, 'reviewing');
  }
  assert.equal(count, 1);
  assert.equal((await run(dir, { ...opts, worker: w })).phase, 'done');
  assert.equal(count, 2);
});
test('feedback arriving during review discards the stale verdict and rechecks the same recorded turn', async t => {
  const { dir } = caseDir(t);
  let calls = 0;
  const ask = async (kind, s, data) => {
    if (kind === 'review' && !calls++) note(dir, 'Include exit code.');
    return ordinary(kind, s, data);
  };
  await run(dir, { ...opts, ask, limit: 1 });
  assert.equal(calls, 2);
  assert.deepEqual(json(path.join(roundDir(dir, 1), 'review-input.json')).userFeedback, ['Include exit code.']);
});
test('an uncertain interruption is never silently replayed or accepted', async t => {
  const { dir } = caseDir(t);
  await assert.rejects(run(dir, { ...opts, worker: async ({ onThread }) => { onThread('fixture'); throw Error('lost connection'); } }), /lost connection/);
  await assert.rejects(run(dir, opts), /outcome unknown/);
  interruptRecord(dir, 'Observed the process stopped before completing.');
  const ask = (kind, s, data) => kind === 'review' ? { verdict: 'blocked', reason: 'No terminal success.', gaps: ['Verify partial changes'], evidence: [], nextPrompt: 'Inspect partial changes before proceeding.' } : ordinary(kind, s, data);
  const state = await run(dir, { ...opts, ask });
  assert.equal(state.phase, 'blocked');
  assert.equal((await run(dir, opts)).phase, 'blocked');
  note(dir, 'I verified the workspace. Continue.');
  assert.equal((await run(dir, opts)).phase, 'done');
});
test('a later correction reopens overall acceptance and simultaneous writers are excluded', async t => {
  const { dir } = caseDir(t);
  const unlock = acquire(dir);
  await assert.rejects(run(dir, opts), /locked/);
  unlock();
  const first = await run(dir, opts);
  note(dir, 'Also verify the revised requirement.');
  const next = await run(dir, opts);
  assert.equal(next.round, first.round + 1);
  assert.equal(next.history.at(-1).index, next.items.length - 1);
});
test('artifact reads stay in the workspace and bounded excerpts expose omissions', t => {
  const { workspace } = caseDir(t);
  const outside = path.join(path.dirname(workspace), 'private.txt');
  fs.writeFileSync(outside, 'outside-data');
  assert.equal(artifacts(workspace, ['../private.txt'])[0].unavailable, 'Path resolves outside workspace');
  assert.throws(() => init(path.join(workspace, 'bad'), workspace, 'goal'), /separate/);
  assert.match(redact('api_key=fixture-password'), /REDACTED/);
  assert.doesNotMatch(redact('Authorization: Bearer fake.secret'), /fake.secret/);
  assert.match(budgetEvidence([{ id:'1', type:'diff', detail:'x'.repeat(1000) }], 120)[0].detail, /TRUNCATED/);
});
test('real Gemini HTTP adapter and Codex stdio adapter interoperate through the full public engine', async t => {
  const { dir } = caseDir(t, []);
  const kinds = [];
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1beta/models/fixture:generateContent');
      assert.equal(req.headers['x-goog-api-key'], 'example-only');
      let bytes = '';
      for await (const chunk of req) bytes += chunk;
      const body = JSON.parse(bytes);
      const data = JSON.parse(body.contents[0].parts[0].text);
      const kind = data.evidence ? 'review' : data.currentTask ? 'brief' : 'plan';
      kinds.push(kind);
      if (kind === 'review') {
        assert.ok(data.evidence.some(r => r.detail.includes('1 passed')));
        assert.doesNotMatch(JSON.stringify(data.evidence), /foreign|omit-private-reasoning/);
      }
      const answer = await ordinary(kind, '', data);
      res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] } }] }));
    } catch (error) { res.statusCode = 500; res.end(error.message); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { ...process.env, GEMINI_MODEL:'fixture', GEMINI_API_KEY:'example-only', GEMINI_BASE_URL:'http://127.0.0.1:' + server.address().port + '/v1beta' };
  const launch = [process.execPath, [fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url))]];
  const state = await run(dir, { ask: gemini(env), worker: o => execute(o, { env, launch }), print: silent });
  assert.equal(state.phase, 'done');
  assert.deepEqual(kinds, ['plan','brief','review','brief','review']);
});
test('Gemini refuses insecure hosts, HTTP errors and partial JSON completions', async () => {
  const env = { GEMINI_API_KEY:'fixture', GEMINI_MODEL:'fixture' };
  await assert.rejects(gemini({ ...env, GEMINI_BASE_URL:'http://example.com' })('brief','',{}), /HTTPS/);
  await assert.rejects(gemini(env, async () => new Response('', {status:403}))('brief','',{}), /403/);
  await assert.rejects(gemini(env, async () => Response.json({ candidates:[{ finishReason:'MAX_TOKENS' }] }))('brief','',{}), /complete/);
});

test('final goal gate catches an omitted requirement and sends every missing part back', async t => {
  const { dir } = caseDir(t, []);
  const missing = ['Verify the second output', 'Check its documented usage'];
  let finalReviews = 0;
  const ask = (kind, system, data) => {
    if (kind === 'review' && data.currentTask.final && ++finalReviews === 1) {
      return { verdict: 'revise', reason: 'The plan missed part of the goal.', gaps: missing, evidence: [], nextPrompt: 'Verify both omitted requirements.' };
    }
    return ordinary(kind, system, data);
  };
  const state = await run(dir, { ...opts, ask });
  assert.deepEqual(state.history.map(h => h.verdict), ['pass','revise','pass']);
  const prompt = read(path.join(roundDir(dir, 3), 'sent-prompt.md'));
  for (const gap of missing) assert.ok(prompt.includes(gap));
});

test('failure before dispatch preserves the prepared instruction for a safe retry', async t => {
  const { dir } = caseDir(t);
  const fail = async () => { throw Object.assign(Error('No executable'), { beforeTurnStart: true }); };
  await assert.rejects(run(dir, { ...opts, worker: fail }), /No executable/);
  const state = json(path.join(dir, 'state.json'));
  assert.equal(state.phase, 'ready');
  assert.equal(state.round, 0);
  assert.equal((await run(dir, opts)).phase, 'done');
});
