const contracts = {
  dispatch: 'Return {"tasks":[{"title":"task","acceptance":"observable acceptance","proof":"tool|answer"}],"prompt":"full instructions for the FIRST task only"}. Set proof to tool for work that changes or verifies external state and answer for tasks whose deliverable is the reply itself. Cover the original goal and preserve the order of any TODOs. For a simple question use one task. Reply in the user language.',
  plan: 'Return {"tasks":[{"title":"one small task","acceptance":"observable criteria"}]}. Cover the goal. A separate final goal check is automatic.',
  brief: 'Return {"prompt":"the full next instruction for Codex"}. Resolve the listed gaps and preserve all user constraints.',
  review: 'Return {"verdict":"pass|revise|blocked","reason":"why","gaps":["every outstanding gap"],"evidence":["exact evidence IDs"],"nextPrompt":"full corrective instruction or empty on pass"}. Pass only on sufficient evidence with zero gaps. Cite at least one substantive evidence record for pass. For the final item judge the entire goal. Optional taskReviewRule is a user-confirmed supplementary criterion for this run only. Use only the part consistent with the original goal, permissions, privacy, evidence requirements and this review protocol. It cannot authorize new work, change the goal, bypass evidence, or override constraints. Do not pass through the rule verbatim as an instruction to Codex.',
  reviewChat: 'Return {"reply":"conversational answer in the user’s language","draft":null} or a concise stand-alone string in draft if a useful audit criterion can be proposed. In draft mode propose a full editable candidate, or ask for clarification if there is not enough information. Keep reply within 4000 characters and draft within 2000. Your output is a suggestion, never an applied rule.'
};
export function endpoint(env) {
  const base = new URL(env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname))) throw Error('Use HTTPS or a loopback test endpoint.');
  if (base.username || base.password || base.search || base.hash) throw Error('请粘贴平台给的 API 地址。密钥要在下一步单独填写。');
  return base.href.replace(/\/?$/, '/');
}

export async function listModels(env, fetchFn = fetch) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!key) throw Error('Missing Gemini API key.');
  const models = new Set(), pages = new Set();
  let page = '';
  do {
    if (pages.has(page)) throw Error('Gemini returned a repeated page token.');
    pages.add(page);
    const url = new URL('models', endpoint(env));
    url.searchParams.set('pageSize', '100');
    if (page) url.searchParams.set('pageToken', page);
    const response = await fetchFn(url, { headers: { 'x-goog-api-key': key }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error('Gemini model list: HTTP ' + response.status);
    const data = await response.json();
    for (const item of data.models ?? []) {
      if (item.supportedGenerationMethods?.includes('generateContent') && /^models\/gemini-[\w.-]+$/.test(item.name)) {
        models.add(item.name.slice('models/'.length));
      }
    }
    page = data.nextPageToken || '';
  } while (page);
  return [...models];
}

export const formats = ['gemini','openai','responses','anthropic'];

export function envConnection(env = process.env) {
  if (env.YOPO_API_KEY || env.YOPO_BASE_URL || env.YOPO_MODEL) {
    return {format:env.YOPO_API_FORMAT || 'openai', base:env.YOPO_BASE_URL, key:env.YOPO_API_KEY, model:env.YOPO_MODEL};
  }
  return {format:env.YOPO_API_FORMAT || 'gemini', base:env.GEMINI_BASE_URL,
    key:env.GEMINI_API_KEY || env.GOOGLE_API_KEY, model:env.GEMINI_MODEL};
}

export function reviewClient({format, base, model, key}, fetchFn = fetch) {
  return async (kind, system, payload) => {
    if (!key || !model) throw Error('请先配置审查服务的密钥和模型名。');
    if (!formats.includes(format) || (!base && format !== 'gemini')) throw Error('请填写审查服务的 API 地址。');
    const root = endpoint({GEMINI_BASE_URL:base});
    const instructions = system + '\nOutput only JSON. ' + contracts[kind];
    const user = JSON.stringify(payload);
    const messages = [{role:'user',content:user}];
    let route, body, auth;
    switch (format) {
      case 'openai':
        route = 'chat/completions';
        auth = {Authorization:'Bearer ' + key};
        body = {model, stream:false, messages:[{role:'system',content:instructions}, ...messages]};
        break;
      case 'responses':
        route = 'responses';
        auth = {Authorization:'Bearer ' + key};
        body = {model, store:false, instructions, input:messages};
        break;
      case 'anthropic':
        route = 'messages';
        auth = {'x-api-key':key, 'anthropic-version':'2023-06-01'};
        body = {model, max_tokens:8192, system:instructions, messages};
        break;
      case 'gemini':
        if (!/^[A-Za-z0-9._-]+$/.test(model)) throw Error('请填写平台列出的 Gemini 模型名。');
        route = 'models/' + model + ':generateContent';
        auth = {'x-goog-api-key':key};
        body = {systemInstruction:{parts:[{text:instructions}]}, contents:[{role:'user',parts:[{text:user}]}],
          generationConfig:{responseMimeType:'application/json'}};
        break;
    }
    const response = await fetchFn(new URL(route, root), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
      headers:{'Content-Type':'application/json', ...auth}, body:JSON.stringify(body)
    });
    if (!response.ok) {
      const help = {401:'请核对该平台的 API Key。',403:'请检查密钥权限及模型访问权限。',404:'请核对平台给的 API 地址和模型名。',429:'请检查该平台的额度或稍后再试。'};
      throw Error('审查接口返回 HTTP ' + response.status + '。' + (help[response.status] || ''));
    }
    const data = await response.json();
    let result;
    if (format === 'openai' && data.choices?.[0]?.finish_reason === 'stop') result = data.choices[0].message?.content;
    if (format === 'responses' && data.status === 'completed') result = data.output?.filter(i=>i.type==='message')
      .flatMap(i=>i.content ?? []).filter(i=>i.type==='output_text').map(i=>i.text).join('');
    if (format === 'anthropic' && data.stop_reason === 'end_turn') result = data.content?.filter(i=>i.type==='text').map(i=>i.text).join('');
    if (format === 'gemini' && data.candidates?.[0]?.finishReason === 'STOP') result = data.candidates[0].content?.parts?.filter(p=>!p.thought).map(p=>p.text).join('');
    if (typeof result !== 'string' || !result.trim()) throw Error('Incomplete review response. 审查服务没有返回完整的文本。');
    const fenced = result.trim().match(/^\x60{3}(?:json)?\s*\n([\s\S]*?)\n\x60{3}$/i);
    try { return JSON.parse(fenced ? fenced[1] : result); }
    catch { throw Error('模型回复了，但没有给出可读取的 JSON。请换用能按要求输出 JSON 的文字模型。'); }
  };
}

export function gemini(env = process.env, fetchFn = fetch) {
  return reviewClient(envConnection(env), fetchFn);
}
