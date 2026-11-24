import { endpoint, listModels } from './gemini.js';
import { providerGroups } from './services.js';

const services = providerGroups.flatMap(group=>group.entries);
const normalize = value => value.trim().normalize('NFKC').toLowerCase().replace(/\s+/g,'');
function presetFor(input) {
  const value=normalize(input);
  return services.find((s,i)=>value===String(i+1) || normalize(s.name)===value || s.aliases.some(a=>normalize(a)===value));
}
function presetConnection(preset, detail) {
  let base = preset.base;
  if (preset.sites) {
    const site = preset.sites.find((s,i)=>detail===String(i+1) || detail===s.name);
    if (!site) throw Error('请选择这把密钥所属的站点编号。');
    base = site.base;
  } else if (preset.address==='azure') {
    if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(detail || '')) {
      base = 'https://'+detail.toLowerCase()+'.openai.azure.com/openai/v1/';
    } else {
      const url = new URL(detail);
      if (url.protocol!=='https:' || url.port || url.username || url.password || url.search || url.hash ||
          !/^[a-z0-9-]+\.(?:openai|services\.ai)\.azure\.com$/.test(url.hostname) ||
          !/^\/(?:openai\/v1\/?)?$/.test(url.pathname)) throw Error('请复制 Azure 控制台的资源名称或资源终结点。');
      base = url.origin+'/openai/v1/';
    }
  } else if (preset.address==='aws') {
    if (!/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(detail || '')) throw Error('请填写 AWS 控制台显示的地域代码，例如 us-east-1。');
    base = 'https://bedrock-runtime.'+detail+(detail.startsWith('cn-')?'.amazonaws.com.cn':'.amazonaws.com')+'/openai/v1/';
  }
  return {format:preset.format || 'openai',base};
}

const fixedEndpoints = services.flatMap(p => (p.sites || (p.base ? [p] : [])).map(s=>({format:p.format || 'openai', base:s.base})));

export function resolveService(input, detail) {
  const known = presetFor(input);
  if (known) return presetConnection(known,detail);
  if (!/^https?:\/\//i.test(input)) throw Error('请填平台名称、前面的数字，或从平台复制一个以 https:// 开头的 API 地址。');
  const url = new URL(endpoint({GEMINI_BASE_URL:input.trim()}));
  const route = url.pathname.replace(/\/$/,'');
  const full = [
    ['openai', /\/chat\/completions$/],
    ['responses', /\/responses$/],
    ['anthropic', /\/messages$/],
    ['gemini', /\/models\/([\w.-]+):generateContent$/]
  ];
  for (const [format, pattern] of full) {
    const match = route.match(pattern);
    if (match) {
      url.pathname = route.slice(0, match.index) + '/';
      return {format,base:url.href,...(match[1] ? {model:match[1]} : {})};
    }
  }
  const official = fixedEndpoints.find(s=>url.href===s.base || (!route && new URL(s.base).origin===url.origin));
  if (official) return {...official};
  if (/\/v1beta$/.test(route)) return {format:'gemini',base:url.href};
  return {format:'openai', base:url.href};
}

async function availableModels({base,format,key},signal) {
  const request=signal ? (url,opts)=>fetch(url,{...opts,signal:AbortSignal.any([signal,opts.signal])}) : fetch;
  if (format==='gemini') return listModels({GEMINI_BASE_URL:base,GEMINI_API_KEY:key},request);
  const headers = format==='anthropic' ? {'x-api-key':key,'anthropic-version':'2023-06-01'} : {Authorization:'Bearer '+key};
  const response = await request(new URL('models',base), {headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Error('HTTP '+response.status);
  return (await response.json()).data?.map(m=>m.id).filter(m=>typeof m==='string') ?? [];
}

async function chooseModel(choices, ask, print) {
  if (!choices.length) {
    print('这个地址没有列出模型，请从平台控制台复制文字模型的模型名。');
    return ask('粘贴模型名（回车退出）：');
  }
  const pageSize=16;
  let matches=choices, page=0;
  for (;;) {
    const start=page*pageSize;
    print(matches.slice(start,start+pageSize).map((m,i)=>(start+i+1)+'. '+m).join('\n') || '没有匹配的模型。');
    const help=choices.length>pageSize ? '，n / p 翻页，/关键词 筛选，/ 显示全部' : '';
    const value=await ask('填列表编号或模型名'+help+'（回车退出）：');
    if (!value) return;
    if (choices.length>pageSize && value.startsWith('/')) {
      const query=value.slice(1).trim().toLowerCase();
      matches=choices.filter(m=>m.toLowerCase().includes(query));
      page=0;
    } else if (choices.length>pageSize && ['n','p'].includes(value)) {
      page=Math.max(0,Math.min(Math.ceil(matches.length/pageSize)-1,page+(value==='n'?1:-1)));
    } else if (!/^\d+$/.test(value)) return value;
    else if (matches[Number(value)-1]) return matches[Number(value)-1];
    else print('列表里没有这个编号。');
  }
}

export async function promptConnection(ask, print=console.log, getModels=availableModels, signal) {
  print('你的 API Key 是在哪个平台领的？输入编号或平台名，例如「豆包」「Kimi」或「OpenRouter」。');
  let number=0;
  for (const group of providerGroups) {
    const entries=group.entries.map(s=>(++number)+'. '+s.name);
    const lines=[];
    for (let i=0;i<entries.length;i+=3) lines.push(entries.slice(i,i+3).join('    '));
    print(group.title+'\n'+lines.join('\n'));
  }
  print('0. 其他平台 / 自建服务（也可以直接粘贴 API 地址）');
  let service;
  while (!service) {
    let answer = await ask('输入平台名称、编号或 API 地址（回车退出）：');
    if (!answer || answer.toLowerCase()==='q') return;
    if (answer==='0') {
      answer=await ask('粘贴服务商给你的 API 地址（Base URL，回车退出）：');
      if (!answer) return;
    }
    const preset=presetFor(answer);
    if (preset?.hint) print(preset.hint);
    let detailPrompt;
    if (preset?.sites) {
      print(preset.sites.map((s,i)=>(i+1)+'. '+s.name).join('    '));
      detailPrompt='这把密钥是在哪个站点或地域申请的？填上面的编号（回车退出）：';
    }
    if (preset?.address==='azure') detailPrompt='粘贴 Azure 控制台的资源名称或资源终结点（回车退出）：';
    if (preset?.address==='aws') detailPrompt='填写 AWS 控制台的地域代码，例如 us-east-1（回车退出）：';
    do {
      const detail = detailPrompt ? await ask(detailPrompt) : undefined;
      if (detailPrompt && !detail) return;
      try { service=resolveService(answer,detail); }
      catch (err) { print(err instanceof TypeError ? '无法识别这个地址，请核对后重新输入。' : err.message); }
    } while (detailPrompt && !service);
  }
  print('密钥和审查请求都会发往 '+service.base);
  const key = await ask('【密钥输入】粘贴这个平台给你的 API Key，然后按回车。输入时不会显示字符：',true);
  if (!key) return;
  print('已收到输入，验证通过后才会保存。');
  if (service.model) return {...service,key};
  let model = await ask('你要用哪个模型审查？填平台模型列表里的模型名（Model ID），或回车查看列表：');
  if (!model) {
    let choices = [];
    try { choices = (await getModels({...service,key},signal)).filter(m=>!/(?:tts|embedding|image|audio|video|robotics)/i.test(m)); }
    catch { /* Some compatible APIs only expose the generation endpoint. */ }
    signal?.throwIfAborted();
    model=await chooseModel(choices,ask,print);
    if (!model) return;
  }
  return {...service,key,model};
}
