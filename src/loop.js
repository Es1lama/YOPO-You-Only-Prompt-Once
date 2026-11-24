import fs from 'node:fs';
import path from 'node:path';
import { acquire, json, read, roundDir, save, settings, write } from './storage.js';
import { artifacts, budgetEvidence, evidence, journal } from './evidence.js';
import { execute } from './codex.js';
import { gemini } from './gemini.js';

const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const list = x => Array.isArray(x) && x.every(nonempty);
export function planTasks(answer) {
  if (!Array.isArray(answer?.tasks) || !answer.tasks.length || !answer.tasks.every(t => nonempty(t.title) && nonempty(t.acceptance))) throw Error('The reviewer returned an invalid task plan.');
  return answer.tasks.map(({ title, acceptance }) => ({ title, acceptance }));
}
export function decision(answer, rows, end) {
  if (!answer || !['pass','revise','blocked'].includes(answer.verdict) || !nonempty(answer.reason) ||
      !list(answer.gaps) || !list(answer.evidence) || typeof answer.nextPrompt !== 'string') throw Error('Invalid review response.');
  const indexed = new Map(rows.map(r => [r.id, r]));
  if (answer.evidence.some(id => !indexed.has(id))) throw Error('Review cited unknown evidence.');
  if (answer.verdict === 'pass') {
    const substantive = answer.evidence.some(id => {
      const r = indexed.get(id);
      return !['start', 'end'].includes(r.type) && !r.detail.startsWith('[Detail omitted') &&
        !(r.type === 'artifact' && r.detail.includes('"unavailable":'));
    });
    if (!substantive || answer.gaps.length || end?.status !== 'completed') throw Error('Pass requires a completed turn, substantive evidence and zero gaps.');
  } else if (!answer.gaps.length || !nonempty(answer.nextPrompt)) {
    throw Error('Revise/blocked must include the gaps and a full follow-up instruction.');
  }
  return { verdict: answer.verdict, reason: answer.reason, gaps: answer.gaps, evidence: answer.evidence, nextPrompt: answer.nextPrompt };
}
function reviewRows(dir, s) {
  const prior = s.history.filter(h => s.items[s.index].final || h.index === s.index);
  return [...prior.flatMap(h => evidence(dir, h.round)), ...evidence(dir, s.round)];
}

export async function run(dir, { ask = gemini(), worker = execute, limit = Infinity, prepare = false, print = console.log } = {}) {
  if (!(limit === Infinity || (Number.isSafeInteger(limit) && limit > 0))) throw Error('Round budget must be a positive integer.');
  const unlock = acquire(dir);
  try {
    const stateFile = path.join(dir, 'state.json');
    const s = json(stateFile);
    const commit = phase => { s.phase = phase; save(stateFile, s); };
    let sent = 0;
    while (true) {
      const cfg = settings(dir);
      const same = () => settings(dir).revision === cfg.revision;
      if (s.phase === 'done' || s.phase === 'blocked') {
        if (s.revision === cfg.revision) return s;
        commit('briefing');
      }
      if (s.phase === 'planning') {
        const tasks = s.todos.length
          ? s.todos.map(title => ({ title, acceptance: title }))
          : planTasks(await ask('plan', cfg.system, { originalGoal: s.goal, feedback: cfg.feedback }));
        if (!same()) continue;
        s.items = [...tasks, { title: 'Final goal check', acceptance: s.goal, final: true }];
        commit('briefing');
        print('Plan saved (' + tasks.length + ' tasks plus final goal check).');
        continue;
      }
      const task = s.items[s.index];
      const context = {
        originalGoal: s.goal, userFeedback: cfg.feedback, plan: s.items,
        currentTask: task, previousReviews: s.history.map(({ index, round, verdict, reason, gaps, evidence }) => ({ index, round, verdict, reason, gaps, evidence }))
      };
      if (s.phase === 'briefing') {
        if (sent >= limit) return s;
        const previous = s.history.at(-1);
        let prompt;
        if (previous?.index === s.index && previous.verdict === 'revise' && previous.revision === cfg.revision) {
          prompt = previous.nextPrompt;
        } else {
          const brief = await ask('brief', cfg.system, { ...context, priorCorrection: previous?.index === s.index ? previous.nextPrompt : '' });
          prompt = brief?.prompt;
        }
        if (!nonempty(prompt)) throw Error('Expected a complete instruction from the reviewer.');
        if (!same()) continue;
        const next = roundDir(dir, s.round + 1);
        fs.mkdirSync(next, { recursive: true });
        write(path.join(next, 'instruction.md'), prompt);
        s.revision = cfg.revision;
        commit('ready');
        continue;
      }
      if (s.phase === 'ready') {
        if (s.revision !== cfg.revision) { commit('briefing'); continue; }
        const next = roundDir(dir, s.round + 1);
        if (prepare) { print('Prepared: ' + path.join(next, 'instruction.md')); return s; }
        if (sent >= limit) return s;
        const instruction = read(path.join(next, 'instruction.md'));
        if (!nonempty(instruction)) throw Error('Empty instruction.');
        const gaps = s.history.at(-1)?.index === s.index ? s.history.at(-1).gaps : [];
        const prompt = [
          'Original user goal:\n' + s.goal, 'User feedback:\n' + JSON.stringify(cfg.feedback),
          'Current task:\n' + JSON.stringify(task), 'Unresolved gaps from previous review:\n' + JSON.stringify(gaps),
          'Full instruction:\n' + instruction
        ].join('\n\n');
        write(path.join(next, 'sent-prompt.md'), prompt);
        s.round++;
        commit('executing');
        sent++;
        print('Round ' + s.round + ' — ' + task.title + '\n' + prompt);
        const events = path.join(next, 'events.jsonl');
        try {
          await worker({
            workspace: s.workspace, threadId: s.threadId, prompt,
            onThread(id) { s.threadId = id; commit('executing'); },
            record(event) { fs.appendFileSync(events, JSON.stringify(event) + '\n', { mode: 0o600 }); }
          });
        } catch (err) {
          if (err.beforeTurnStart) { s.round--; commit('ready'); }
          throw err;
        }
        continue;
      }
      const folder = roundDir(dir, s.round);
      const events = path.join(folder, 'events.jsonl');
      if (s.phase === 'executing') {
        const rows = journal(events);
        if (!rows.some(e => e.type === 'end')) throw Error('Turn outcome unknown. Inspect the journal and workspace. After verifying the worker has stopped, use interrupt-record to mark the incomplete attempt.');
        // One atomic artifact snapshot per turn, including on recovery after a crash.
        const snapshots = path.join(folder, 'artifacts.json');
        if (!fs.existsSync(snapshots)) save(snapshots, artifacts(s.workspace, s.artifacts));
        commit('reviewing');
        continue;
      }
      if (s.phase !== 'reviewing') throw Error('Unknown run phase: ' + s.phase);
      let rows = reviewRows(dir, s);
      const selected = [...s.history.filter(h => task.final || h.index === s.index).map(h => h.round), s.round];
      const extra = selected.flatMap(n => json(path.join(roundDir(dir, n), 'artifacts.json')).map((a, i) => ({ id: 'r' + n + ':a' + (i + 1), type: 'artifact', detail: JSON.stringify(a) })));
      rows = budgetEvidence([...rows, ...extra]);
      const end = journal(events).find(e => e.type === 'end');
      const request = { ...context, sentPrompt: read(path.join(folder, 'sent-prompt.md')), turnStatus: end.status, evidence: rows };
      save(path.join(folder, 'review-input.json'), request);
      write(path.join(folder, 'reviewer-system.md'), cfg.system);
      const review = decision(await ask('review', cfg.system, request), rows, end);
      if (!same()) continue;
      save(path.join(folder, 'review.json'), review);
      s.history.push({ index: s.index, round: s.round, revision: cfg.revision, ...review });
      s.revision = cfg.revision;
      print('Round ' + s.round + ': ' + review.verdict + ' — ' + review.reason + (review.gaps.length ? '\n' + review.gaps.join('\n') : ''));
      if (review.verdict === 'pass') {
        if (task.final) { commit('done'); return s; }
        s.index++;
      }
      if (review.verdict === 'blocked') { commit('blocked'); return s; }
      commit('briefing');
    }
  } finally { unlock(); }
}

export function interruptRecord(dir, why) {
  if (!nonempty(why)) throw Error('Supply the observed reason.');
  const unlock = acquire(dir);
  try {
    const s = json(path.join(dir, 'state.json'));
    if (s.phase !== 'executing') throw Error('Only an uncertain executing turn can be marked interrupted.');
    const file = path.join(roundDir(dir, s.round), 'events.jsonl');
    if (journal(file).some(x => x.type === 'end')) throw Error('A terminal event already exists; resume with run.');
    fs.appendFileSync(file, JSON.stringify({ type: 'end', status: 'interrupted', source: 'operator', error: why }) + '\n', { mode: 0o600 });
  } finally { unlock(); }
}
