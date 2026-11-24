import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { json, settings } from '../src/storage.js';
import { configure, tryProject } from '../src/try.js';
import { listModels } from '../src/gemini.js';

const quiet = () => {};
function answers(...values) {
  return async prompt => { assert.ok(values.length, 'Unexpected question: ' + prompt); return values.shift(); };
}
function home(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yo-po-onboarding-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('public first-run setup hides the key, selects a listed model, and retries invalid input', async () => {
  const env = {};
  const prompts = [], output = [], values = ['temporary-example','99','2'];
  const ask = async (label, hidden) => { prompts.push(hidden); return values.shift(); };
  const ok = await configure(env, ask, t => output.push(t), async cfg => {
    assert.equal(cfg.GEMINI_API_KEY, 'temporary-example');
    return ['gemini-fixture-a','gemini-fixture-b','gemini-fixture-tts'];
  });
  assert.ok(ok);
  assert.equal(prompts[0], true);
  assert.equal(env.GEMINI_MODEL, 'gemini-fixture-b');
  assert.doesNotMatch(output.join('\n'), /temporary-example|fixture-tts/);
});

test('model selection uses public API pagination, filters by generation support and sends the key only as a header', async () => {
  const urls = [];
  const fetchModels = async (url, opts) => {
    urls.push(url);
    assert.equal(opts.headers['x-goog-api-key'], 'unit-test-key');
    assert.equal(opts.redirect, 'error');
    if (url.searchParams.has('pageToken')) return Response.json({ models: [{ name:'models/gemini-two', supportedGenerationMethods:['generateContent'] }] });
    return Response.json({ models: [
      { name:'models/gemini-one', supportedGenerationMethods:['generateContent'] },
      { name:'models/gemini-nontext', supportedGenerationMethods:['embedContent'] }], nextPageToken:'next'
    });
  };
  const models = await listModels({ GOOGLE_API_KEY:'unit-test-key' }, fetchModels);
  assert.deepEqual(models, ['gemini-one','gemini-two']);
  assert.ok(urls.every(u => u.hostname === 'generativelanguage.googleapis.com' && !u.href.includes('unit-test-key')));
  assert.equal(urls[1].searchParams.get('pageToken'), 'next');
});

test('an unconfigured user can leave a real run pending, resume it, give feedback, and see the output path', async t => {
  const base = home(t), messages = [];
  await tryProject({ home:base, providerDir:base, env:{}, print:m => messages.push(m), ask:answers('1','Make one file','result.txt',''), check:async () => {}, runTask:() => assert.fail('missing key dispatched work') });
  const dir = path.join(base, fs.readdirSync(base)[0], 'run');
  const initial = json(path.join(dir, 'state.json'));
  assert.equal(initial.goal, 'Make one file');
  assert.deepEqual(initial.artifacts, ['result.txt']);
  assert.equal(initial.phase, 'planning');
  let calls = 0;
  await tryProject({ home:base, providerDir:base, env:{GEMINI_API_KEY:'fixture',GEMINI_MODEL:'fixture'}, print:m => messages.push(m),
    check:async () => {}, ask:answers('2',dir,'s','Use Chinese'), runTask:async (runDir, opts) => {
      assert.equal(runDir, dir);
      assert.equal(opts.limit, 1);
      return { round:++calls, phase:calls === 1 ? 'briefing' : 'done' };
    }
  });
  assert.deepEqual(settings(dir).feedback, ['Use Chinese']);
  assert.ok(messages.at(-1).includes(initial.workspace));
});

test('the default real exercise generates a different verifiable file challenge per run', async t => {
  const base = home(t);
  for (let i = 0; i < 2; i++) {
    await tryProject({ home:base, providerDir:base, env:{}, print:quiet, ask:answers('1','',''), check:async () => {}, runTask:() => assert.fail() });
  }
  const states = fs.readdirSync(base).map(d => json(path.join(base,d,'run','state.json')));
  assert.notEqual(states[0].goal, states[1].goal);
  assert.deepEqual(states[0].artifacts, ['hello.txt']);
  assert.equal(fs.existsSync(path.join(states[0].workspace, 'hello.txt')), false);
});

test('the offline menu identifies the scripted exercise and never contacts a provider', async () => {
  const output = [];
  await tryProject({ ask:answers('3'), print:m => output.push(m), check:() => assert.fail(), getModels:() => assert.fail() });
  const paths = output.at(-1).split('\n');
  const workspace = paths[0].slice('打开产物：'.length);
  try {
    assert.ok(output.some(m => m.includes('固定脚本模拟')));
    assert.equal(fs.readFileSync(path.join(workspace,'greeting.txt'),'utf8').trim(),'Hello');
  } finally { fs.rmSync(path.dirname(workspace), { recursive:true, force:true }); }
});
