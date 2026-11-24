import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { json, save } from './storage.js';
import { endpoint, envConnection, formats, gemini, reviewClient } from './gemini.js';

export const userDir = () => process.env.YOPO_HOME ? path.resolve(process.env.YOPO_HOME) : path.join(os.homedir(), '.yo-po');
export const providerFile = dir => path.join(dir, 'provider.json');

function dpapi(value, decrypt) {
  const convert = decrypt
    ? '[Convert]::FromBase64String($s)'
    : '[Text.Encoding]::UTF8.GetBytes($s)';
  const method = decrypt ? 'Unprotect' : 'Protect';
  const format = decrypt ? '[Text.Encoding]::UTF8.GetString($data)' : '[Convert]::ToBase64String($data)';
  const script = '$ErrorActionPreference="Stop"; Add-Type -AssemblyName System.Security; ' +
    '$s=[Console]::In.ReadToEnd(); $data=[Security.Cryptography.ProtectedData]::' + method +
    '(' + convert + ',$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write(' + format + ')';
  const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(shell, ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    { input:value, encoding:'utf8', windowsHide:true, timeout:15000 });
  if (result.status !== 0 || !result.stdout) throw Error('Windows 无法读取或保存当前用户的审查 API 密钥。');
  return result.stdout;
}

export function storeProvider(dir, { format, base, model, key }) {
  if (!formats.includes(format) || !base || !model?.trim() || !key?.trim()) throw Error('请填写服务地址、模型名和密钥。');
  const url = endpoint({ GEMINI_BASE_URL:base });
  fs.mkdirSync(dir, { recursive:true, mode:0o700 });
  const protectedKey = process.platform === 'win32' ? { dpapi:dpapi(key,false) } : { apiKey:key };
  save(providerFile(dir), { format, base:url, model:model.trim(), ...protectedKey });
}
export function savedProvider(dir) {
  if (!fs.existsSync(providerFile(dir))) return null;
  const cfg = json(providerFile(dir));
  if (!formats.includes(cfg.format) || !cfg.base || !cfg.model || !(cfg.dpapi || cfg.apiKey)) return null;
  return {format:cfg.format, base:endpoint({GEMINI_BASE_URL:cfg.base}), model:cfg.model};
}
export async function verifyAndSaveProvider(dir, config, fetchFn=fetch, signal) {
  const request = signal ? (url,opts)=>fetchFn(url,{...opts,signal:AbortSignal.any([opts.signal,signal])}) : fetchFn;
  const sample = await reviewClient(config,request)('brief','Connectivity check.',{originalGoal:'Reply with a short acknowledgement.'});
  if (typeof sample?.prompt!=='string' || !sample.prompt.trim()) throw Error('模型没有按要求回传测试结果。请检查模型名或选择其他文字模型。');
  signal?.throwIfAborted();
  storeProvider(dir,config);
}
export function reviewer(dir, env = process.env, signal) {
  const request=signal ? (url,opts)=>fetch(url,{...opts,signal:AbortSignal.any([opts.signal,signal])}) : fetch;
  if (!fs.existsSync(providerFile(dir))) {
    const {key,model}=envConnection(env);
    if (!model || !key) throw Error('尚未配置审查 API。打开 Yo-po.cmd 或运行 npm start。');
    return gemini(env,request);
  }
  const cfg = json(providerFile(dir));
  const key = cfg.dpapi ? dpapi(cfg.dpapi,true) : cfg.apiKey;
  return reviewClient({...cfg,key},request);
}
