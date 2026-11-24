import { createInterface } from 'node:readline';
const input = createInterface({ input: process.stdin });
const emit = m => process.stdout.write(JSON.stringify(m) + '\n');
for await (const line of input) {
  const { method, params, id } = JSON.parse(line);
  if (method === 'initialize') { emit({ id, result: { userAgent: 'fixture' } }); continue; }
  if (method === 'initialized') continue;
  if (method === 'thread/start' || method === 'thread/resume') {
    if (params.approvalPolicy !== 'never' || params.sandbox !== 'workspace-write') process.exit(8);
    if (method === 'thread/resume' && params.threadId !== 'thread-fixture') process.exit(9);
    emit({ id, result: { thread: { id: 'thread-fixture' } } });
    continue;
  }
  if (method === 'turn/start') {
    if (!params.input[0].text.includes('Original user goal:') || process.env.GEMINI_API_KEY) process.exit(10);
    const threadId = 'thread-fixture', turnId = 'turn-fixture';
    const event = (method, value) => emit({ method, params: { threadId, turnId, ...value } });
    emit({ method: 'turn/completed', params: { threadId: 'unrelated', turn: { id: turnId, status: 'failed' } } });
    // Intentionally deliver early notifications before the JSON-RPC response.
    event('item/completed', { item: { type: 'commandExecution', command: 'example-test', exitCode: 0, aggregatedOutput: '1 passed' } });
    emit({ id, result: { turn: { id: turnId } } });
    emit({ method: 'item/completed', params: { threadId, turnId: 'other-turn', item: { type: 'agentMessage', text: 'foreign' } } });
    event('item/completed', { item: { type: 'reasoning', text: 'omit-private-reasoning' } });
    event('turn/diff/updated', { diff: '+ example fixture' });
    event('turn/completed', { turn: { id: turnId, status: 'completed' } });
  }
}
