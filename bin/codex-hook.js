#!/usr/bin/env node
import { handle } from '../src/native.js';

try {
  const parts = [];
  for await (const part of process.stdin) parts.push(part);
  const result = await handle(JSON.parse(Buffer.concat(parts).toString('utf8').replace(/^\uFEFF/,'')));
  process.stdout.write(JSON.stringify(result));
} catch {
  process.stdout.write(JSON.stringify({ systemMessage:'Yo-po 未能处理本轮事件，本轮未验收。' }));
}
