# 选择审查平台

先看密钥是在哪家平台领的。在 Yo-po 设置里输入下表的编号、平台名或常用别名。比如在硅基流动调用 DeepSeek，就选硅基流动。选好后，窗口会显示密钥将发往的地址。按提示选模型，连接测试通过后才会保存。

## 常用平台

| 编号 | 密钥来自 | 接口地址或需要填写的内容 |
| --- | --- | --- |
| 1 | [Google AI Studio（Gemini）](https://ai.google.dev/api/generate-content) | `https://generativelanguage.googleapis.com/v1beta/` |
| 2 | [OpenAI（GPT）](https://developers.openai.com/api/reference/resources/responses/methods/create) | `https://api.openai.com/v1/` |
| 3 | [DeepSeek](https://api-docs.deepseek.com/) | `https://api.deepseek.com/` |
| 4 | [Anthropic（Claude）](https://platform.claude.com/docs/en/api/messages/create) | `https://api.anthropic.com/v1/` |

## 国内开放平台

| 编号 | 密钥来自 | 接口地址或需要填写的内容 |
| --- | --- | --- |
| 5 | [阿里云百炼（通义千问）](https://help.aliyun.com/zh/model-studio/base-url) | 北京 · 按量付费 `https://dashscope.aliyuncs.com/compatible-mode/v1/`<br>新加坡 · 按量付费 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/`<br>美国弗吉尼亚 · 按量付费 `https://dashscope-us.aliyuncs.com/compatible-mode/v1/`<br>中国香港 · 按量付费 `https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1/`<br>北京 · Token Plan `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/` |
| 6 | [月之暗面（Kimi）](https://www.kimi.com/help/kimi-api/api-troubleshooting) | 国内开放平台 `https://api.moonshot.cn/v1/`<br>国际开放平台 `https://api.moonshot.ai/v1/` |
| 7 | [智谱（GLM / Z.AI）](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction) | 智谱国内站 · 通用 API `https://open.bigmodel.cn/api/paas/v4/`<br>Z.AI 国际站 · 通用 API `https://api.z.ai/api/paas/v4/` |
| 8 | [火山方舟（豆包）](https://docs.volcengine.com/docs/ark/chat-api) | `https://ark.cn-beijing.volces.com/api/v3/` |
| 9 | [腾讯云 TokenHub（混元）](https://cloud.tencent.com/document/product/1823/132252) | `https://tokenhub.tencentmaas.com/v1/` |
| 10 | [百度千帆（文心）](https://cloud.baidu.com/doc/qianfan-api/s/wmwbqm1wv) | `https://qianfan.baidubce.com/v2/` |
| 11 | [MiniMax（海螺）](https://platform.minimax.cn/docs/api-reference/text-anthropic-api) | 中国站 `https://api.minimax.cn/anthropic/v1/`<br>国际站 `https://api.minimax.io/anthropic/v1/` |
| 12 | [硅基流动（SiliconFlow）](https://docs.siliconflow.cn/docs/userguide/capabilities/stream-mode) | `https://api.siliconflow.cn/v1/` |
| 13 | [讯飞星火](https://www.xfyun.cn/doc/spark/HTTP调用文档.html) | `https://spark-api-open.xf-yun.com/v1/` |
| 14 | [阶跃星辰（StepFun）](https://platform.stepfun.com/) | `https://api.stepfun.com/v1/` |
| 15 | [小米 MiMo](https://mimo.mi.com/docs/zh-CN/quick-start/faq/api-integration) | `https://api.xiaomimimo.com/v1/` |

## 国际模型与聚合平台

| 编号 | 密钥来自 | 接口地址或需要填写的内容 |
| --- | --- | --- |
| 16 | [xAI（Grok）](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions) | `https://api.x.ai/v1/` |
| 17 | [Mistral AI](https://docs.mistral.ai/inference/conversations/chat-completion) | `https://api.mistral.ai/openai/v1/` |
| 18 | [Cohere](https://docs.cohere.com/docs/compatibility-api) | `https://api.cohere.ai/compatibility/v1/` |
| 19 | [Perplexity](https://docs.perplexity.ai/docs/agent-api/openai-compatibility) | `https://api.perplexity.ai/v1/` |
| 20 | [OpenRouter](https://openrouter.ai/developers) | `https://openrouter.ai/api/v1/` |
| 21 | [GroqCloud](https://console.groq.com/docs/openai) | `https://api.groq.com/openai/v1/` |
| 22 | [Together AI](https://docs.together.ai/docs/inference/openai-compatibility) | `https://api.together.ai/v1/` |
| 23 | [Fireworks AI](https://docs.fireworks.ai/api-reference/post-chatcompletions) | `https://api.fireworks.ai/inference/v1/` |
| 24 | [Hugging Face](https://huggingface.co/docs/inference-providers/index) | `https://router.huggingface.co/v1/` |
| 25 | [NVIDIA NIM](https://build.nvidia.com/stepfun-ai/step-5-preview/apireference) | `https://integrate.api.nvidia.com/v1/` |
| 26 | [Cerebras](https://inference-docs.cerebras.ai/resources/glm-47-migration) | `https://api.cerebras.ai/v1/` |

## 云账号专用入口

| 编号 | 密钥来自 | 接口地址或需要填写的内容 |
| --- | --- | --- |
| 27 | [Microsoft Azure OpenAI](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle) | 填 Azure 控制台的资源名或公网资源终结点，模型栏填部署名。 |
| 28 | [Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html) | 填 AWS 控制台的地域代码，使用同地域 Bedrock API Key 和模型 ID。 |
| 29 | [Google Cloud Vertex AI（Express）](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/express-mode/overview) | `https://aiplatform.googleapis.com/v1/publishers/google/` |

若密钥来自其他平台、专属业务空间或自建服务，选 **0** 后粘贴控制台提供的 API 地址，也可在第一步直接粘贴。多站点平台应选领密钥的站点。Azure 此入口适用于公共云 API Key，Google Cloud 此入口适用于 Express API Key。

模型栏接受平台给出的完整模型名。模型列表较长时，输入 `/qwen` 等关键词筛选，输入 `/` 恢复全部，`n`、`p` 翻页，输入屏幕上的编号完成选择。火山方舟也接受推理接入点 ID。讯飞星火的 HTTP 密钥在控制台标为 APIPassword。
