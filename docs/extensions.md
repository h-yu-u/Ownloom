# Skills、MCP 与本地能力工具

[文档入口](./README.md) · [Coding](./coding.md) · [架构](./architecture.md) · [验收状态](./status.md)

## 使用入口

设置侧栏和概览统一使用“扩展能力”入口，页面内通过 Skills、MCP 服务、内置工具三个页签切换，分别对应 `/settings/extensions/skills`、`/settings/extensions/mcp`、`/settings/extensions/builtin`。三个页签均高亮同一个设置分类，已有深链接继续有效。管理扩展不需要先创建 Coding 项目。

Skills 随应用提供图片提示词与口播整理两个静态示例。导入本地目录时选择适用工作区，先审阅正文、文件清单与依赖，再确认创建受管版本。更新版本使用相同审阅过程；预览不改变目录版本，确认时核对预览内容摘要。导入的脚本仅是静态资源，不执行 setup、安装或脚本。正文必须含 Pi 1.2.0 支持的名称和描述 frontmatter。

MCP 本地服务填写已安装程序的绝对入口、参数数组和工作目录；HTTP 服务填写 HTTPS URL，本机回环服务可用 HTTP。公开环境变量或 headers 与秘密字段分开填写。支持无凭据、Bearer、API Key 或 stdio 环境秘密；凭据只显示“已配置”，不会回填明文。可导入本产品的公开 JSON 配置并审阅表单，不导入 Pi 原生命令或秘密字段。

保存服务后先“测试连接”发现工具，再在“配置与工具授权”勾选白名单。只有用户核实并标为只读的工具可以在分析/审查模式使用，服务自报 annotation 不授予权限。每次保存会发布新配置版本；修改授权后需要再测试该版本。测试只握手和发现工具/资源目录，不调用业务工具；本地测试会启动配置的程序，取消或测试结束会关闭这次连接。

Coding 输入栏的“技能与工具”可选择本次能力，并保存工作区或项目默认值。选择会在提交时冻结为运行快照。普通启用、停用或配置更新对下一任务生效；“立即撤销”停止当前和等待中的相关运行。开发模式的有副作用工具逐次显示参数审批，拒绝后不会发送调用。MCP 连接按自身授权联网，与聊天联网搜索开关分别管理。

普通聊天使用原有聊天、附件与联网准备流程，不展示技能选择器或“交给工具助手”入口。独立 Agent Chat 使用 Pi 工具循环、审批和已选择的 MCP/媒体能力，会话不伪装成 Coding 项目，不提供项目文件或命令工具。工具模型需通过原有 Coding 工具协议检查；普通文字 Skill 和创作助手不要求工具模板。

图片“提示词助手”和语音“口播助手”选择文字模型及 Skill，输出可编辑草稿，用户应用后沿用原生成按钮与业务参数校验；文字助手本身不会生成媒体。Coding/工具助手可选择本地图片、语音工具，绑定已登记媒体模型及模式。图片参考/蒙版、克隆音色使用受管 ID，不能提供任意磁盘路径。媒体工具完成后提供作品链接，可打开原图片/语音工作区查看、复用或导出。作品引用不等于模型看到了图片。

## 数据和执行边界

| 数据 | 所有者与位置（相对应用数据目录） |
|---|---|
| Skill、MCP 版本、工具目录、默认绑定、撤销、操作及 mutation 回执 | Node，`coding/extensions.db` |
| Skill 不可变文件 | Node，`coding/skills/<id>/<contentRevision>/` |
| Coding 会话、任务、审批、变更、事件 | Node，原 `coding/coding.db` |
| Agent Chat 会话、任务、审批、事件及 Pi 上下文路径 | Node，`coding/agent-chat/agent-chat.db` 和独立 Pi transcript |
| 模型、普通聊天、图片/语音 Job、作品、助手草稿、调用关联账本 | Python，原应用 SQLite/媒体目录 |
| MCP 明文凭据 | Python SecretStore 与系统 Keychain，独立 MCP 命名空间；原 Web Search 命名空间兼容保留 |

内部 Host RPC 升至 v2；单一描述仍为 `packages/coding-protocol/schema.json`。同源生成 Node 类型/校验数据、Python RPC 及扩展 HTTP DTO；HTTP OpenAPI 继续生成前端类型。Runtime 的公开握手和 `/internal/v1` 路径保持原版本，Host v1/v2 混用明确拒绝。

Node 是扩展目录唯一写者。配置采用不可变版本与 `expectedRevision` 并发检查；配置、事件、mutation 回执同事务保存。相同 mutation/submission 编号与相同意图返回原结果，不同意图报冲突。秘密替换以 mutation 和字段建立稳定 Keychain 引用，在 Keychain 内比较重复输入；Node 只持有引用，运行时私有上下文才注入所选连接的秘密。未引用旧版本与暂存秘密保守保留，自动 GC 未启用。

Skill 导入复制到暂存目录，检查普通文件、目录边界、大小与摘要，再原子发布。Pi 解析显式受管路径，默认 Skills、Prompts、Extensions、全局配置和项目扩展发现均关闭。运行先读取所选 Skill 正文，后续参考文件只经 `read_skill` 校验清单和摘要；项目 `read` 权限不扩大。管理元数据 revision 与实际 contentRevision 分开，普通停用不会让旧运行找错文件目录。

MCP 使用固定 Pi 1.2.0 官方 extension factory 与公开 transport API。应用在工具注册处核对名称、schema 和版本，在 execute Gateway 内计数、校验、审批，并在 transport 发包前再次核对原工具、独立参数快照和连接代际。只向模型直接暴露选中白名单工具。JSON Schema 使用 AJV 严格 draft-07 校验，不在线加载 `$ref`；未知 dialect/format 明确拒绝。

MCP 返回值在进入 Pi 临时结果转换前限制为文本与有界结构化 JSON，并脱敏秘密。图片、音频、嵌入资源及通知不进入模型；进度、日志、采样和服务器主动请求不转发。HTTP 不重定向、不启动 OAuth、不自动刷新凭据或重放工具 POST；调用后失联按结果未知处理，用户需核对远端状态。本地 stdio 不继承桌面 Token、能力 bearer 或完整 shell 环境，不自动运行 npx/uvx 安装。这是应用准入与审批边界，不是操作系统沙箱。

## 调度、取消与恢复

Coding 保留一个活动运行与一项等待队列，Agent Chat 与它共用活动准入。prepare 先固定快照并预约位置，Python 再登记 pending grant、解析精确连接版本的凭据，最后 commit。进入队首后 activate 才签发短期运行 bearer，排队不消耗活动授权时间。重复 prepare/commit/activate 不产生第二个运行或 grant；未 commit 预约有独立期限。

每步文字推理独立登记并取得原 JobScheduler 租约，释放后才等待 MCP 或提交图片/语音 Job。AgentRun 本身不持有父推理锁。媒体 reserve → 原业务 create → bind 在运行接纳锁内完成，随后释放接纳锁等待终态；调用编号确定业务 submission，未显式 seed 只首次生成并冻结一次。

取消、撤销、到期及 Host 代际变化会关闭新接纳，等待正在提交的关联完成，并取消该运行登记的文字及媒体 Job。create 成功但 bind 前失败时，重试、关闭和重启恢复均按原 submission 查回任务，不重放媒体创建。重启令牌失效、旧运行中断、未决审批作废；账本恢复只补关联，不恢复执行旧工具。已成功作品保留。

Runtime 增量迁移 8 保存助手提交/草稿，迁移 9 保存运行范围与调用关联。账本只记录授权快照、预算、输入和 Job 归属，绝不持久化 bearer；Job 状态仍以原业务仓储为准。

| 限制 | 当前值 |
|---|---|
| 结构化模型可见工具 | 最多 16，含 Coding 基础工具和 `read_skill` |
| 每运行模型/工具步骤、媒体创建 | 最多 48 步、4 次媒体创建 |
| 未 commit 预约 / pending bootstrap / active grant | 60 秒 / 24 小时 / 20 分钟 |
| MCP 测试、启动与 HTTP 请求 | 有独立硬期限，最长 15 秒 |
| MCP 单消息/HTTP 响应、模型结果 | 1 MiB / 12 KiB；结构化结果深度 24、节点 2048 |
| Skill 包、文件数、正文、单次参考读取 | 20 MiB、200 文件、64 KiB、256 KiB |
| 上下文 | 提交快照与最终模型输入均检查预算，超限明确失败 |

## 验证与尚未开放的能力

运行 `pnpm check`、`pnpm test`、`pnpm build:web`、`pnpm build:coding:bundle`。RPC/OpenAPI 变化后先运行 `pnpm rpc:generate`、`pnpm api:generate`。分发检查实际启动包内 Node Host，读取目录验证内置 Skill 与工具资源，并等待正常退出。

`services/coding-agent/tests/extensions.test.mjs` 与 `pi-extensions.test.mjs` 使用真实 Pi SDK、stdio/HTTP 假服务，验证环境隔离、版本、transport 准入、schema/参数修改、审批、输出拦截、认证失败、取消与进程清理。`tests/test_extension_api.py` 验证管理 API、文本 Skill/助手和版本化秘密注入；秘密存储使用内存替身，不读取用户 Keychain。

`tests/test_extension_capabilities.py` 覆盖可控时钟排队激活、取消接纳窗口、create/bind 故障、重启补关联、预算和令牌不落盘。`tests/test_extension_workflows.py` 实际串联 HTTP Runtime、Node/Pi、FakeEngine，分别在 Coding 与独立 Agent Chat 执行文字 → 图片 → 文字 → 语音 → 文字，验证逐次审批、可解码 PNG/WAV、作品归属与租约释放。前端回归覆盖选择器跨作用域竞态、冲突草稿、MCP 表单秘密类型与丢失响应重试。

本轮浏览器检查覆盖三个设置入口、Skill 资源抽屉、MCP 表单、聊天选择器与 Agent 抽屉，并修正窄窗口宽度；使用隔离数据和 FakeEngine。新链路的真实 MLX/MFLUX/语音模型、真实远程 MCP 服务与凭据、签名身份下 Keychain、完整 Sidecar/.app、正式签名/公证、干净机器与长期压力尚未验收。旧版本真实模型验收不能替代这些新链路证据。

自动 Skill 激活、Git 固定 commit 导入、脚本执行、MCP Resources 读取/媒体结果、OAuth、Prompts、Apps UI、视觉闭环和多 Agent 调度保留为后续能力；当前 UI 明确标出未开放项。提示词助手本期输出文本草稿，参数继续由原表单编辑和验证，不宣称模型参数结构化生成。

## 局部函数长度例外

文件仍遵守工程硬上限。以下函数保留超过 60 行的局部例外：`guardedTransport`、`mcpResources`、`openPi` 需在同一闭包中维持 SDK 回调、连接代际、准入和 awaitable close；`ManagedSkillFiles.import` 需保持暂存发布与失败补偿连续；`ResourceResolver.resolve`、`Extensions.dispatch` 保持单一快照推导/生成协议分派；`AgentChat.execute` 保持审批、Pi 订阅与 finally 清理连续；各扩展 controller 工厂、`McpServerForm.save` 及 composition root 保持局部响应式状态和依赖装配。领域转换、工具参数校验、仓储、HTTP 转发与媒体创建已经拆至明确模块。这些例外不豁免类型、依赖边界、文件长度与行为回归检查，后续新增职责应继续拆分。
