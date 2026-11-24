# 独立命令行模式

## 第一次使用

需要 Node.js 22 或更新版本。下载源码后，在项目目录运行 `node bin/yo-po.js try`。项目使用 Node 标准库，无需安装 npm 依赖。

选 **1 真实模型**，输入你自己的题目。直接回车会生成一道带随机标记的文件题，便于你逐字检查最后的产物。每次新任务都有独立的工作目录和运行记录。向导会打印这两个路径。

- **Codex** 使用你自己的 Codex CLI 登录。首次使用请先安装 CLI 并执行 `codex login`。[Codex CLI](https://developers.openai.com/codex/cli/)
- **审查模型**使用你在 `npm start` 里接好的服务。首次使用也可以在独立向导中填领密钥的平台名，或粘贴其他服务商的 API 地址。独立向导临时输入的密钥只在本次运行使用。
- **亲自验收**时，可以自动跑完整个任务，也可以输入 `s` 逐轮检查。逐轮模式支持在两轮之间加入你自己的意见。用文件管理器打开产物目录，按原始要求核对内容。选 **2** 可通过运行目录继续已有任务。
- **离线示例**在选项 **3**，也可运行 `npm run demo`。固定脚本模拟两个模型，实际创建文件并演示一次返工，无需登录或密钥。开发测试使用 `npm test`。

## 运行自己的任务

1. 安装并登录 Codex CLI。在同一个终端里确认 `codex --version` 能运行。Windows 也可以用 `CODEX_BIN` 指定官方 `codex.exe` 的完整路径。
2. 在项目目录运行 `npm start` 连接审查服务，或设置下表中的环境变量。已保存的接口优先。
3. 准备一个工作目录，另选一个同级目录保存运行记录。下面假设 `../my-project` 已存在，`../review-run` 尚未创建。

```sh
node bin/yo-po.js doctor
node bin/yo-po.js init ../review-run --workspace ../my-project --goal "写一份快速入门，包含安装步骤和一个可运行的例子" --artifact README.md
node bin/yo-po.js run ../review-run
```

`doctor` 会和本机 Codex 完成协议握手，并显示 已选的审查模型。真实任务才会请求模型。每个运行都从一个专用 Codex 会话开始，随后各轮续接同一会话。命令进程运行期间自动派工和审查。可以在另一个终端查看进度或补充意见。

```sh
node bin/yo-po.js status ../review-run
node bin/yo-po.js note ../review-run "安装步骤要覆盖 Windows，请实际核对命令。"
```

补充意见会进入下一次派工或审查。遇到审查途中追加的意见，程序会按新意见重新检查同一份记录。已结束的运行在加入新意见后，再执行 `run` 就能重新核对。外层工具（例如 Claude Code）也可以通过这几个命令发起任务、读取 JSON 状态和补充要求。

## 调整审查模型的关注点

- **长期规则**在运行目录的 `reviewer.md`。它由仓库里的 [默认审查提示词](../prompts/reviewer.md) 复制而来。例如，可以加上“凡是说测试通过，都要引用带退出码的工具结果”。
- **完整派工指令**可以先预览。执行 `node bin/yo-po.js run ../review-run --prepare`，编辑输出路径下的 `instruction.md`，然后正常执行 `run`。发送时会一并附上你的原始目标、最新意见和之前的缺项，实际发出的全文保存在 `sent-prompt.md`。
- **已有 TODO** 可以在初始化时加 `--todos tasks.json`。它接受 JSON 字符串数组，如 `["修好空输入", "补回归测试", "更新用法"]`。程序按给定顺序执行。省略这个选项时，审查模型根据原始目标拆分。
- **长目标**可以用 `--goal-file goal.md` 代替 `--goal`。如果你只想先运行两轮，可加 `--rounds 2`。到达轮数后保留进度，执行 `run` 即可继续，只有最终审查通过才会显示 `done`。

## 能看到哪些证据

Codex 通过本机 app-server 的标准输入输出通信。程序按会话 ID 和轮次 ID 收集已结束的工具调用、命令结果、文件修改、回复和 diff，收到对应的 `turn/completed` 后立即请选定的模型审查。无需轮询所有聊天或依赖执行者自己回报。

可多次指定 `--artifact`。程序会在每轮结束后，直接从工作区读取这些文本文件，记录内容摘录和 SHA-256。缺失文件、越界路径、非文本文件和大于 1 MiB 的文件会留下原因。长输出会明确标出截断。审查结果要引用本次任务中存在的证据编号，执行失败或中断的轮次不能被记作通过。模型仍可能误判证据，重要工作可以打开原始记录复核。

| 运行目录中的文件 | 用途 |
| --- | --- |
| `state.json` | 原始目标、TODO、当前进度、Codex 会话 ID 和历次判定 |
| `reviewer.md`、`feedback/` | 运行中的审查规则和用户追加意见 |
| `rounds/0001/sent-prompt.md` | 当轮真正发给 Codex 的完整提示词 |
| `rounds/0001/events.jsonl`、`artifacts.json` | 本轮选定的原生事件和工作区文件快照 |
| `rounds/0001/review-input.json`、`reviewer-system.md` | 提供给审查模型的审查数据与当轮自定义规则。协议输出格式由适配器附加 |
| `rounds/0001/review.json` | 通过、返工或阻塞的原因、缺项、证据编号和下一轮指令 |

## 暂停与恢复

审查服务出错时，修好配置后重新运行 `run`，程序会重新审查已经保存的执行结果。一轮已经发出而结果未知时，程序会暂停，避免重复执行可能已经生效的操作。先查看工作区、会话和 `events.jsonl`，确认执行者已停止后，把观察到的情况写入记录，再继续。

```sh
node bin/yo-po.js interrupt-record ../review-run "已确认进程退出，工具只完成了第一处修改"
node bin/yo-po.js run ../review-run
```

同一运行目录同时只允许一个执行进程。若进程被强制终止，`run.lock` 可能残留。核对其中的主机名和 PID，确认原进程已经结束，再删除该锁文件。显示 `blocked` 时，查看最后一次审查给出的具体原因，补上所需信息后使用 `note` 和 `run` 继续。

## 模型连接和数据范围

| 变量 | 用途 |
| --- | --- |
| `YOPO_API_KEY`、`YOPO_MODEL`、`YOPO_BASE_URL` | 服务商给你的密钥、模型名、API 根地址。根地址不含 `/chat/completions`、`/responses`、`/messages` 等方法路径 |
| `YOPO_API_FORMAT` | `openai`（默认，Chat Completions）、`responses`、`anthropic` 或 `gemini` |
| `GEMINI_API_KEY` | Gemini API 密钥，也兼容 `GOOGLE_API_KEY` |
| `GEMINI_MODEL` | Gemini 审查模型 ID |
| `GEMINI_BASE_URL` | 可选，兼容原生 Gemini API 的地址，默认 Google 的 v1beta 接口。自定义地址会收到请求和 Gemini 密钥 |
| `CODEX_BIN` | 可选，Codex 可执行文件 |
| `CODEX_MODEL`、`CODEX_EFFORT` | 可选，执行模型与思考档位，省略时使用 Codex 自身设置 |

真实运行会将原始任务、用户意见、当轮指令、选定的命令输出、文件改动及指定文件摘录发给你配置的审查服务。程序会遮盖部分常见凭据格式，业务数据和未识别的秘密仍可能出现在输出中。请在适合双方模型访问的工作区运行，运行目录应保存在源码目录之外。Codex 使用 `workspace-write` 沙箱。项目不会把 审查服务专用密钥传给 Codex 子进程。模型调用使用各自服务的额度。

使用其他平台的示例见[审查服务配置](../README.md)。独立模式通过 [Codex app-server](https://developers.openai.com/codex/app-server/) 运行。项目使用 [CC BY-NC 4.0 许可](../LICENSE)。
