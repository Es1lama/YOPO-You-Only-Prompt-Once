#!/usr/bin/env node
import { handle } from '../src/native.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const parts = [];
  for await (const part of process.stdin) parts.push(part);
  // The installer copies this file to <profile>/runtime/<digest>/bin/. Do not depend on
  // Codex forwarding a caller's environment override to each hook subprocess.
  const bundle=path.dirname(path.dirname(fileURLToPath(import.meta.url))), runtime=path.dirname(bundle);
  const home=path.basename(runtime)==='runtime' && /^[0-9a-f]{20}$/.test(path.basename(bundle)) ? path.dirname(runtime) : undefined;
  const result = await handle(JSON.parse(Buffer.concat(parts).toString('utf8').replace(/^\uFEFF/,'')),{home});
  process.stdout.write(JSON.stringify(result));
} catch {
  process.stdout.write(JSON.stringify({ systemMessage:'Yo-po 未能处理本轮事件，本轮未验收。' }));
}
