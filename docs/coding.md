# Coding 工作区

聊天与 Coding 的默认会话标题取首条非空用户输入的前 7 个字符，去除首尾空白并将换行、连续空白合并为一个空格；不足 7 个字符时保留全文。提交接纳后立即同步侧栏，后续追问不改名，手动重命名优先。已有默认标题会在相应服务启动时按最早输入补齐，保持原有排序与消息；空会话仍显示默认名称。Coding 的模型工具探针和独立验证不用于生成标题。

Coding 是独立的本地项目开发工作区。第一版接入 Pi 1.2.0 SDK，复用当前 Runtime 的单活 MLX Worker，不启动第二套推理系统，也不向远程 Provider 发送项目内容。

## 使用

1. 在 Coding 菜单打开本地项目，再新建开发会话。打开项目只读取目录、Git 状态与受限的 `AGENTS.md`，不会安装依赖、运行项目脚本或加载扩展。
2. 选择 Coding 模型后直接发送任务。首次使用或模型版本变化时，应用自动在临时目录准备模型并检查工具协议；失败保留输入并显示具体原因。Fake 模型仅用于协议开发，不能据此认定真实模型可靠。
3. 选择分析、开发或审查模式。分析和审查只提供读取、搜索、目录与 Git 状态工具；开发增加写入、编辑和命令工具。运行中的任务保持启动时的模式；访问权限可在输入栏单独切换。
4. 输入栏默认“需要审批”：审查具体命令及目录，允许本次或拒绝；测试和验证配置修改、非只读 MCP 调用也保留审批。明确选择“完全访问”后，这些操作直接执行并保存授权记录，无需逐项点击；可对当前任务生效，释放该任务的待批准操作，切回后后续操作恢复审批。选择仅在当前会话记忆，不给其他会话自动授权。命令以本机用户权限运行，可访问项目外文件和网络；这不是操作系统沙箱。分析和审查保持只读，完全访问也不移除受管文件路径限制、扩展撤销检查、Git 操作限制及取消/超时机制。
5. 通过“补充当前任务”加入 steering；“接下来再做”进入宿主的一项等待队列，当前任务结束并持久化结果后才启动。应用同时只执行一个 Coding 任务。
6. 顶部显示共享的 Runtime 运行状态与实时系统内存，右侧用一个面板图标展开或收起“变更与文件”，展开时图标高亮。面板内部通过“变更 / 文件”标签切换，本次工作区内收起再展开会回到上次查看的标签，首次默认显示变更；关闭按钮同样可收起。右侧面板可拖动调整宽度，对话与输入保留在左侧。Runtime 断开时可重试，重连后恢复当前项目和会话；窗口变窄时页头操作换行排列。
7. 变更面板按文件展示本会话受管修改，支持行内/并排差异、打开文件和撤销最近一次修改；也可切换查看 Git 工作区。文件面板提供目录树、路径搜索、只读源码、行号、语法着色和 ⌘/Ctrl+F 搜索。模型文字实时更新同一条回复；工具活动按发生顺序接在正文后，正在运行的命令直接展示名称，完成记录折叠为操作组，输出和错误按需展开。顶部不再重复显示执行横幅。输入栏统一为文本框及一排“技能与工具、模式、模型、访问权限、更多选项”，发送、补充和停止使用图标按钮；收尾验证开关放入更多选项。

设置 → Coding 保存独立默认模型及 4K–32K 上下文预算。模型工具能力证据绑定引擎、模板/配置内容和权重文件版本；变化后发送时自动重新准备。普通开发任务由模型按需调用命令，按当前访问权限执行或请求审批，不再执行旧项目设置中的收尾检查命令，也不展示独立的“运行验证、项目设置、验证”入口。内部能力探针和兼容 API 仍保留检查机制。

普通命令记录标记为 `purpose=command`，成功不改变任务的 `verification=not_run`。仅显式验证或内部能力探针在提交时冻结检查命令列表，其记录标记为 `purpose=verification`；每一步只采用当前文件指纹下的最新尝试，缺步骤或过期返回 partial，全部步骤成功才返回 passed。这里的 passed 只证明该列表执行成功，不证明全部需求已满足。旧记录缺少检查归属时保留输出，但不追认为验证证据。

查看器复用已有 Naive UI 文件树，新增 [CodeMirror](https://github.com/codemirror/dev) / Lezer 与 [Diff2Html](https://github.com/rtfpessoa/diff2html)、[jsdiff](https://github.com/kpdecker/jsdiff)；查看器及语法模块按需加载，不增加远程服务。所引入组件为 MIT 许可，包含其完整依赖许可的 `apps/desktop/public/third-party-notices.txt` 随前端构建进入应用包。布局参考 [Codex 官方的文件差异审阅流程](https://developers.openai.com/blog/mastering-codex-remote-for-engineering)，未复制 Codex 专有界面代码。

会话可搜索、重命名、置顶、归档或删除。切换页面和会话仅改变观察对象，不停止任务；删除或归档有活动任务的会话会被拒绝。删除记录不删除用户项目目录。会话及关联任务、审批、变更、命令记录与事件在 Coding SQLite 中整体事务删除，任一步失败全部回滚；Pi JSONL 与项目文件不属于此事务。Pi JSONL 保留为独立的本地上下文审计数据，本次删除不清理它，不承诺跨文件事务。

## 架构与数据

```text
Vue Coding → 认证 Runtime HTTP / Coding SSE
                    → Node Pi Host（按需启动；产品 NDJSON）
                         → Pi SessionManager
                         → 受管文件、审批与命令执行
                         → scoped local Provider HTTP
                              → JobScheduler 单次推理租约 → MLX Worker
```

Python 网关转发产品操作，不保存另一份 Coding 状态。Node 单独写入应用数据目录下的 `coding/coding.db`；Pi JSONL 是最终模型上下文的权威来源。应用不会继承全局 Pi 配置、项目可执行扩展、默认 MCP、自动安装或隐式 setup。用户在统一设置明确导入的 Skill、配置并授权的 MCP 可通过输入栏选择，使用受管快照和原工具审批，详见 [Skills、MCP 与本地工具](./extensions.md)。

状态更新及产品事件在同一 SQLite 事务内提交，事件序号跨重启保持递增。快照展示最近 100 个记录、50 个任务和 20 条命令执行记录；累计文字增量只保留最新一条进入快照，避免高频流式更新挤掉对话历史，较早记录仍保存在 Coding 数据库/Pi 会话中。文件内容按需读取，事件只保留有限预览，避免大文件进入重连快照。Coding 观察器使用独立的 SSE 序号及快照 watermark，不把开发任务当作推理 Job。进程重启将未完成任务标记为 interrupted，并拒绝未决审批；不自动重放不确定是否执行过的命令。

Coding 数据库通过 `user_version` 增量迁移增加会话、项目、任务、提交编号、状态及事件游标索引，旧 JSON 载荷与会话 ID 保留。高频查询在 SQLite 内筛选，快照只读取当前会话的有限窗口。会话与变更列表各按 100 条游标分页，界面可继续加载；文件详情单独读取，差异基线仍来自该文件最早未撤销记录。`events.wait` 由已提交写入唤醒，空闲最多等待 20 秒后发送心跳。持久化事件负责重连回放，通知不替代历史。前端增量投影任务、审批、命令与时间线，缺口或未知协议代际触发快照恢复。

内部 RPC 方法、请求/结果和稳定错误码由 `packages/coding-protocol/schema.json` 定义。修改后执行 `pnpm rpc:generate`，`pnpm check` 检查生成漂移；Python/Node 运行相同协议 fixtures。模型准备归属应用用例，Node RPC 入口组合 ProjectSessions、ChangeService、CapabilityVerifier 与 Runs。Host 保留组件、操作、请求 ID、耗时和错误码等结构化诊断；stderr 仅计数后丢弃，不默认输出 SDK 内容。

内部推理入口 `/internal/v1/inference` 支持文本与工具的 Chat Completions 子集：完整消息历史、工具 ID/结果、工具 JSON Schema、自动/禁止工具选择、非流式及 SSE 响应。工具参数完成并通过校验后才交给执行器；输出截断、非法 JSON/XML、未知工具和缺失工具结果明确失败。正文增量经 Pi SDK 转成 `assistant.delta` 事件传到时间线，使用固定消息 ID 就地更新；结束时以完整消息替换，避免重复。工具参数仍在单次模型结果完整解析及校验后才允许执行。外部 `/v1` 兼容接口不因此开放。

目前工具解析支持带 `<tool_call>` 的 JSON 模板，以及 Qwen XML 的 `<function>` / `<parameter>` 模板。其他模板保持未验证，不按模型名称放行。同一响应可包含多个工具调用，整批解析成功后由 Pi 按顺序执行，每个命令按当前访问权限决定是否审批；不并发执行工具。真实模型的多模态 Coding 输入不在本版协议范围。

访问菜单的布局与策略参考 [Codex 官方权限说明](https://learn.chatgpt.com/docs/sandboxing#how-permissions-work)，沿用项目现有 Vue / Naive UI 与 Pi SDK 实现，没有引入新依赖或复制 Codex 专有代码。

## 文件、命令与撤销

文件工具限制在规范项目路径内，拒绝 symlink、越界路径、凭据/私钥路径、依赖和构建目录。文本读写上限为 512 KiB，写前检查读取时的内容摘要，并校验打开的文件与目标路径仍对应同一文件。写入前保存恢复记录，崩溃时无法确认完成的记录保留 pending 状态供审查。

“受管修改”保存前后内容，可与工作区全部 Git 变化和任务起始 Git 状态区别查看。撤销前检查当前内容是否仍等于该次写入结果，发生人工或外部编辑时拒绝覆盖。命令产生的变化不能可靠归因给文件工具，不会自动重置、stash 或回滚仓库。

命令只获得精简工具链环境，不继承桌面 Token、Provider 凭据或完整用户环境。项目工具不在默认工具链路径中时，模型可在待审批命令中使用其完整路径；不会执行 shell 启动脚本来隐式继承环境。单条命令最长 120 秒、日志上限 64 KiB；每个任务最多 48 次模型工具调用和 20 分钟。命令使用独立进程组，正常取消和关闭时终止后代；Runtime 追踪 Host 通知的命令组，在 Host 崩溃后清理已登记进程。连续强制杀死 Runtime 和 Host 的系统级故障仍需额外验收。

验证摘要覆盖排除目录之外的项目文件，最多 2000 个、目录深度 32、单文件 64 MiB；超过范围明确失败，不显示通过。目录浏览和搜索另有限定条数/深度，并展示上限。文件快照、Pi JSONL 和 SQLite 不共享事务，不承诺磁盘副作用 exactly once。

## 开发与验收

```bash
pnpm install --frozen-lockfile
pnpm build:coding
pnpm check
pnpm test
pnpm build:web
pnpm check:rust
pnpm test:rust
pnpm build:coding:bundle
```

`pnpm dev` / `pnpm dev:web` 会先构建 Host；`pnpm test:runtime` 也会先构建它。Pi、pi-ai 与 TypeBox 使用锁定发布版本，Node 22 的内置 SQLite 避免增加 SQLite 原生模块。Pi 的其他 Provider 依赖来自上游包，但产品只注册本地 MLX Provider；相关安装脚本保持禁用。

Coding 分发资源包含固定 Host、锁定依赖与 Node 22 可执行文件，生成 `provenance.json`。分发使用 hoisted 的实际文件布局；构建检查移除开发工具入口及工作区自链接，拒绝任何逃逸资源目录的链接。Tauri 正式构建通过固定资源目录传给 Runtime，不接受前端指定程序路径。本机包使用 Tauri 支持的临时签名 `-`，保持 hardened runtime，并通过 `Entitlements.plist` 允许 PyInstaller 解压的 Python/MLX 动态库加载（这些库的 Team ID 与临时签名不同）。这不等同于正式 Developer ID 签名或公证。配置依据见 [Tauri macOS 签名文档](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing)。

隔离协议及内置运行时验收：

```bash
uv run --frozen --project services/runtime --python 3.12 \
  python scripts/verify_local_coding.py \
  --bundled-host apps/desktop/src-tauri/resources/coding-agent \
  --output .build/coding-bundled-fake.json
```

真实本地模型验收：

```bash
uv run --frozen --project services/runtime --extra mlx-vlm --python 3.12 \
  python scripts/verify_local_coding.py \
  --model-path /path/to/Qwen3.8-27B-Uncensored-MLX/4-bit \
  --bundled-host apps/desktop/src-tauri/resources/coding-agent \
  --output .build/coding-real.json
```

默认脚本只在隔离目录修改固定测试文件，输出可复查的工具事件、变更及验证证据。增加 `--task '完成一个简单的web图书馆系统'` 可继续在隔离空项目运行真实开发需求，逐项交互审查审批，并保存 `*-task.json` 与 `*-task.project/` 产物。脚本化 Provider 特意先制造检查失败再修复；真实模型不要求生成相同文本或故意失败。

本版完成 Coding 设计阶段 A/B 的开发闭环，并新增受管 Skills/MCP 与媒体工具。Worktree、交互 PTY、IDE 交接、细粒度 Git、多 Agent 和周期任务仍属后续阶段。正式签名、公证、无开发工具的干净机器与长期资源压力不能由源码测试或本机打包代替；扩展新链路的验证边界单独记录在[扩展文档](./extensions.md)，实际验收结果见[状态](./status.md)。


要复验最终应用包，可为上述命令同时指定 `--sidecar`（`.app/Contents/MacOS/mlx-studio-runtime`）与 `--bundled-host`（`.app/Contents/Resources/coding-agent`），路径含空格时加引号。完整本机结果和局限见[验收状态](./status.md#coding-接入验收2026-10-16)。

## 交互更新验收（2026-10-27）

- 真实 Pi SDK 连接受控 SSE 服务，验证最终响应完成前就收到文字增量，最终消息沿用同一 ID；这项测试不模拟 Pi 事件。
- HTTP → Runtime → Node Host → FakeEngine 集成覆盖初始完全访问、任务等待审批时切换完全访问、幂等重试及授权记录。Node 回归另覆盖切回审批和只读模式限制。
- 组件与纯函数测试覆盖累计更新不重复、500 次增量不挤掉原始请求、命令生命周期合并为一条记录、运行状态置于时间线和输入快捷键。
- 使用实际时间线与输入组件的隔离预览检查桌面及窄窗口、权限菜单和停止按钮；预览项目与文字为测试数据，不是模型生成的图书馆项目。真实 MLX 模型流式体验、实际开发任务质量及正式应用包尚未在本次验收中复测。

主要改动位于 `CodingComposer.vue` / `CodingTimeline.vue` / `CodingPage.vue`、Coding 的 `coding-permissions.ts` / `coding-activity.ts`、Host 的 `pi-events.ts` / `approvals.ts` / `run-policy.ts`，以及对应 HTTP、API 客户端和 RPC 合约。`pnpm check`、`pnpm test`（551 项）和 `pnpm build:web` 通过；最后的展示绑定调整另外通过前端类型检查、Lint、时间线测试及 Web 构建。构建仍报告部分既有分包超过 500 kB，未在本次交互改动中调整分包。

侧栏布局更新：`CodingSidebar.vue` 与独立样式 `CodingSidebar.styles.css` 使用紧凑导航层级，项目名称下拉中切换/打开项目，列表标题右侧新建会话，顶部搜索按需展开，归档移入列表菜单。会话行高约 36 px（运行状态占两行），长标题省略并保留完整提示；置顶显示小图标，行操作在悬停、聚焦或选中时显示，触摸设备始终显示。搜索自动聚焦，Escape 清空并将焦点还给搜索按钮；新建及切换项目会退出过滤视图。已用实际组件检查 1200 / 800 px 桌面窗口、搜索与 Escape、归档中新建、项目切换、键盘操作及置顶；预览使用测试项目和会话。未新增依赖。
