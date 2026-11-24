// Menu numbers follow this order. Keep existing entries in place when adding providers.
export const providerGroups = [
  { title:'常用平台', entries:[
    { name:'Google AI Studio（Gemini）', aliases:['google', 'gemini', 'google ai studio'],
      base:'https://generativelanguage.googleapis.com/v1beta/',
      format:'gemini' },
    { name:'OpenAI（GPT）', aliases:['openai', 'gpt'],
      base:'https://api.openai.com/v1/',
      format:'responses' },
    { name:'DeepSeek', aliases:['deepseek', '深度求索'],
      base:'https://api.deepseek.com/' },
    { name:'Anthropic（Claude）', aliases:['anthropic', 'claude'],
      base:'https://api.anthropic.com/v1/',
      format:'anthropic' }
  ] },
  { title:'国内开放平台', entries:[
    { name:'阿里云百炼（通义千问）', aliases:['阿里', '阿里云', '百炼', '阿里云百炼', '通义', '通义千问', '千问', 'qwen', 'dashscope'],
      sites:[
        {name:'北京 · 按量付费', base:'https://dashscope.aliyuncs.com/compatible-mode/v1/'},
        {name:'新加坡 · 按量付费', base:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/'},
        {name:'美国弗吉尼亚 · 按量付费', base:'https://dashscope-us.aliyuncs.com/compatible-mode/v1/'},
        {name:'中国香港 · 按量付费', base:'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1/'},
        {name:'北京 · Token Plan', base:'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/'}
      ],
      hint:'如控制台给了业务空间专属地址，可在平台列表直接粘贴那个地址。' },
    { name:'月之暗面（Kimi）', aliases:['月之暗面', '月之暗面kimi', 'kimi', 'moonshot'],
      sites:[
        {name:'国内开放平台', base:'https://api.moonshot.cn/v1/'},
        {name:'国际开放平台', base:'https://api.moonshot.ai/v1/'}
      ] },
    { name:'智谱（GLM / Z.AI）', aliases:['智谱', '智谱ai', 'glm', 'z.ai', 'zai', 'bigmodel'],
      sites:[
        {name:'智谱国内站 · 通用 API', base:'https://open.bigmodel.cn/api/paas/v4/'},
        {name:'Z.AI 国际站 · 通用 API', base:'https://api.z.ai/api/paas/v4/'}
      ] },
    { name:'火山方舟（豆包）', aliases:['火山', '火山引擎', '火山方舟', '豆包', 'doubao', 'ark', 'volcengine'],
      base:'https://ark.cn-beijing.volces.com/api/v3/',
      hint:'北京地域。模型一栏可填方舟控制台给你的模型 ID 或推理接入点 ID（ep-…）。' },
    { name:'腾讯云 TokenHub（混元）', aliases:['腾讯', '腾讯云', '混元', 'hunyuan', 'tokenhub', '腾讯混元'],
      base:'https://tokenhub.tencentmaas.com/v1/' },
    { name:'百度千帆（文心）', aliases:['百度', '百度千帆', '千帆', '文心', '文心一言', 'ernie', 'qianfan'],
      base:'https://qianfan.baidubce.com/v2/' },
    { name:'MiniMax（海螺）', aliases:['minimax', '海螺', '稀宇', '稀宇科技'],
      sites:[
        {name:'中国站', base:'https://api.minimax.cn/anthropic/v1/'},
        {name:'国际站', base:'https://api.minimax.io/anthropic/v1/'}
      ],
      format:'anthropic' },
    { name:'硅基流动（SiliconFlow）', aliases:['硅基', '硅基流动', 'siliconflow'],
      base:'https://api.siliconflow.cn/v1/' },
    { name:'讯飞星火', aliases:['讯飞', '星火', '讯飞星火', 'iflytek', 'spark'],
      base:'https://spark-api-open.xf-yun.com/v1/',
      hint:'密钥栏请填讯飞控制台为星火 HTTP 接口签发的 APIPassword。' },
    { name:'阶跃星辰（StepFun）', aliases:['阶跃', '阶跃星辰', 'stepfun'],
      base:'https://api.stepfun.com/v1/' },
    { name:'小米 MiMo', aliases:['小米', '小米mimo', 'mimo', 'xiaomi'],
      base:'https://api.xiaomimimo.com/v1/',
      hint:'此入口使用按量付费 API Key。' }
  ] },
  { title:'国际模型与聚合平台', entries:[
    { name:'xAI（Grok）', aliases:['xai', 'grok'],
      base:'https://api.x.ai/v1/' },
    { name:'Mistral AI', aliases:['mistral', 'mistral ai'],
      base:'https://api.mistral.ai/openai/v1/' },
    { name:'Cohere', aliases:['cohere', 'command r'],
      base:'https://api.cohere.ai/compatibility/v1/' },
    { name:'Perplexity', aliases:['perplexity', 'pplx'],
      base:'https://api.perplexity.ai/v1/',
      format:'responses' },
    { name:'OpenRouter', aliases:['openrouter'],
      base:'https://openrouter.ai/api/v1/' },
    { name:'GroqCloud', aliases:['groq', 'groqcloud'],
      base:'https://api.groq.com/openai/v1/' },
    { name:'Together AI', aliases:['together', 'together ai'],
      base:'https://api.together.ai/v1/' },
    { name:'Fireworks AI', aliases:['fireworks', 'fireworks ai'],
      base:'https://api.fireworks.ai/inference/v1/' },
    { name:'Hugging Face', aliases:['hugging face', 'huggingface', 'hf'],
      base:'https://router.huggingface.co/v1/' },
    { name:'NVIDIA NIM', aliases:['nvidia', 'nim', '英伟达'],
      base:'https://integrate.api.nvidia.com/v1/' },
    { name:'Cerebras', aliases:['cerebras'],
      base:'https://api.cerebras.ai/v1/' }
  ] },
  { title:'云账号专用入口', entries:[
    { name:'Microsoft Azure OpenAI', aliases:['azure', 'azure openai', 'microsoft azure', '微软'],
      address:'azure',
      format:'responses',
      hint:'模型一栏请填你在 Azure 创建的部署名称。' },
    { name:'Amazon Bedrock', aliases:['aws', 'bedrock', 'amazon bedrock', '亚马逊'],
      address:'aws',
      hint:'使用 Amazon Bedrock API Key，并填写该地域支持 Chat Completions 的模型 ID。' },
    { name:'Google Cloud Vertex AI（Express）', aliases:['vertex', 'vertex ai', 'google cloud', 'vertex express'],
      base:'https://aiplatform.googleapis.com/v1/publishers/google/',
      format:'gemini',
      hint:'此入口使用 Google Cloud Express 模式的 API Key。可直接粘贴支持的 Gemini 模型名。' }
  ] }
];
