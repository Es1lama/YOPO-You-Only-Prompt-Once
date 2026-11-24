import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

function command(env) {
  if (env.CODEX_BIN) return [env.CODEX_BIN, []];
  if (process.platform === 'win32') {
    for (const folder of (env.PATH || env.Path || '').split(path.delimiter)) {
      const exe = path.join(folder, 'codex.exe');
      if (fs.existsSync(exe)) return [exe, []];
      const script = path.join(folder, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (fs.existsSync(script)) return [process.execPath, [script]];
    }
  }
  return ['codex', []];
}

export function connect(env = process.env, launch = command(env)) {
  const childEnv = { ...env };
  for (const key of ['YOPO_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete childEnv[key];
  const child = spawn(launch[0], [...launch[1], 'app-server'], {
    stdio: ['pipe', 'pipe', 'pipe'], env: childEnv, windowsHide: true
  });
  const pending = new Map();
  let ended, onEvent = () => {}, onFailure = () => {}, seq = 0;
  function die(err) {
    if (ended) return;
    ended = err;
    for (const req of pending.values()) req.reject(err);
    pending.clear();
    onFailure(err);
  }
  const send = msg => child.stdin.write(JSON.stringify(msg) + '\n');
  const input = createInterface({ input: child.stdout });
  input.on('line', line => {
    try {
      const msg = JSON.parse(line);
      if (msg.method && msg.id != null) {
        send({ id: msg.id, error: { code: -32601, message: 'Interactive server request unsupported in unattended mode.' } });
      } else if (msg.method) {
        onEvent(msg);
      } else if (pending.has(msg.id)) {
        const req = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) req.reject(Error('Codex RPC: ' + msg.error.message));
        else req.resolve(msg.result);
      }
    } catch (err) { die(err); }
  });
  child.stderr.resume();
  child.on('error', die);
  child.stdin.on('error', die);
  child.on('close', code => die(Error('Codex app-server closed (exit ' + code + ').')));
  function call(method, params) {
    if (ended) return Promise.reject(ended);
    const id = ++seq;
    let timeout;
    return new Promise((resolve, reject) => {
      timeout = setTimeout(() => { pending.delete(id); reject(Error('Timed out waiting for ' + method)); }, 90000);
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    }).finally(() => clearTimeout(timeout));
  }
  return {
    call,
    async initialize() {
      const result = await call('initialize', { clientInfo: { name: 'yo_po', title: 'Yo-po — You Only Prompt Once', version: '0.3.1' }, capabilities: {} });
      send({ method: 'initialized', params: {} });
      return result;
    },
    listen(event, failure) { onEvent = event; onFailure = failure; if (ended) failure(ended); },
    close() { child.stdin.end(); child.kill(); input.close(); }
  };
}

export async function execute({ workspace, prompt, threadId, onThread, record }, options = {}) {
  const env = options.env || process.env;
  const client = connect(env, options.launch);
  let dispatched = false;
  try {
    await client.initialize();
    const cfg = { cwd: workspace, approvalPolicy: 'never', sandbox: 'workspace-write' };
    if (env.CODEX_MODEL) cfg.model = env.CODEX_MODEL;
    const started = threadId
      ? await client.call('thread/resume', { ...cfg, threadId })
      : await client.call('thread/start', cfg);
    const thread = started.thread.id;
    if (!thread || (threadId && thread !== threadId)) throw Error('Unexpected thread identity.');
    onThread(thread);
    let turnId;
    const early = [];
    let resolveEnd, rejectEnd;
    const end = new Promise((resolve, reject) => { resolveEnd = resolve; rejectEnd = reject; });
    end.catch(() => {});
    function receive({ method, params }) {
      if (params?.threadId !== thread) return;
      if (!['item/completed', 'turn/diff/updated', 'turn/completed'].includes(method)) return;
      if (!turnId) { early.push({ method, params }); return; }
      if ((params.turnId ?? params.turn?.id) !== turnId) return;
      if (method === 'item/completed') {
        const item = params.item;
        if (['reasoning', 'userMessage'].includes(item.type)) return;
        record({ type: 'item', turnId, item });
      } else if (method === 'turn/diff/updated') {
        record({ type: 'diff', turnId, diff: params.diff });
      } else {
        record({ type: 'end', turnId, status: params.turn.status, error: params.turn.error?.message });
        resolveEnd();
      }
    }
    client.listen(receive, rejectEnd);
    const input = [{ type: 'text', text: prompt, text_elements: [] }];
    dispatched = true;
    const turn = await client.call('turn/start', { threadId: thread, input, ...(env.CODEX_EFFORT ? { effort: env.CODEX_EFFORT } : {}) });
    turnId = turn.turn.id;
    if (!turnId) throw Error('Missing turn ID.');
    record({ type: 'start', threadId: thread, turnId });
    for (const event of early) receive(event);
    await end;
  } catch (err) {
    if (!dispatched) err.beforeTurnStart = true;
    throw err;
  } finally { client.close(); }
}
