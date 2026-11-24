import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('Windows native form: Chinese messages, editable draft and explicit Apply emit distinct target-bound frames', {skip:process.platform!=='win32'},()=>{
  const file=fileURLToPath(new URL('../windows/review-chat.ps1',import.meta.url));
  assert.ok(fs.existsSync(file),'review chat has a real Windows form');
  const fixture=fileURLToPath(new URL('./fixtures/review-chat-ui.ps1',import.meta.url));
  const runner='. ([ScriptBlock]::Create([IO.File]::ReadAllText($env:YOPO_FORM_FILE,[Text.Encoding]::UTF8))); & ([ScriptBlock]::Create([IO.File]::ReadAllText($env:YOPO_FORM_TEST,[Text.Encoding]::UTF8)))';
  const r=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(runner,'utf16le').toString('base64')],
    {env:{...process.env,YOPO_FORM_FILE:file,YOPO_FORM_TEST:fixture},encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/FORM-OK/);
});
