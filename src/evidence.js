import fs from 'node:fs';
import path from 'node:path';
import { hash, inside, read, roundDir } from './storage.js';

export function redact(text) {
  return text.replace(/(-----BEGIN [\w ]*PRIVATE KEY-----)[\s\S]*?-----END [\w ]*PRIVATE KEY-----/g, '[REDACTED PEM]')
    .replace(/\b(?:sk-(?:proj-)?[\w-]{12,}|AIza[\w-]{20,}|gh[pousr]_[\w]{16,}|github_pat_[\w]{20,})/g, '[REDACTED TOKEN]')
    .replace(/(Bearer\s+)[A-Za-z0-9_.~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/((?:password|api[_-]?key|access[_-]?token|secret)[\s"']*[:=][\s"']*)[^\s"',;}]+/gi, '$1[REDACTED]');
}
export function journal(file) {
  if (!fs.existsSync(file)) return [];
  return read(file).split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function excerpt(value, size) {
  const text = redact(value);
  if (text.length <= size) return text;
  const half = Math.floor(size / 2);
  return text.slice(0, half) + '\n[TRUNCATED ' + (text.length - 2 * half) + ' characters]\n' + text.slice(-half);
}
export function artifacts(workspace, names) {
  return names.map(name => {
    const result = { type: 'artifact', name };
    try {
      const file = fs.realpathSync(path.resolve(workspace, name));
      if (!inside(workspace, file)) throw Error('Path resolves outside workspace');
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('Expected regular text file up to 1 MiB');
      const data = fs.readFileSync(file);
      const content = new TextDecoder('utf-8', { fatal: true }).decode(data);
      if (content.includes('\0')) throw Error('Binary data');
      return { ...result, sha256: hash(data), content: excerpt(content, 6000) };
    } catch (err) { return { ...result, unavailable: err.code || err.message }; }
  });
}

export function evidence(dir, number) {
  const rows = journal(path.join(roundDir(dir, number), 'events.jsonl'));
  return rows.map((row, i) => {
    const data = row.item ?? row;
    return { id: 'r' + number + ':e' + (i + 1), type: data.type, detail: excerpt(JSON.stringify(data), 9000) };
  });
}

// Keep a visible index even when a very long turn exceeds the review context budget.
export function budgetEvidence(rows, budget = 110000) {
  let remaining = budget;
  return rows.map((r, i) => {
    const allowance = Math.min(9000, Math.max(0, Math.floor(remaining / (rows.length - i))));
    const detail = allowance >= r.detail.length ? r.detail : (allowance < 100 ? '[Detail omitted by context budget]' : excerpt(r.detail, allowance));
    remaining = Math.max(0, remaining - detail.length);
    return { ...r, detail };
  });
}
