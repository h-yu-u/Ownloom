# Skills、MCP 与本地能力工具

[子系统索引](./README.md) · [系统架构](../architecture.md) · [Coding](./coding.md) · [验证范围](../verification.md)

## 职责与边界

扩展子系统管理受管 Skill、MCP 服务版本、工具白名单和工作区默认绑定，并将用户选择冻结为运行快照。Node 拥有扩展目录和执行准入，Python 拥有 Keychain、模型与媒体用例，Vue 提供管理、审阅和选择界面。

普通聊天继续走聊天、附件与网页资料准备；独立 Agent Chat 使用 Pi 工具循环，不伪装成 Coding 项目，也没有项目文件或命令工具。图片提示词助手、语音口播助手只产生可编辑文本草稿；用户应用草稿后才进入原媒体生成流程。

## 事实来源

| 主题               | 代码入口与关键符号                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管理与版本         | [extensions/application/service.ts](../../services/coding-agent/src/extensions/application/service.ts)：`Extensions`                                                                                                         |
| 快照与权限解析     | [resolver.ts](../../services/coding-agent/src/extensions/application/resolver.ts)：`ResourceResolver`                                                                                                                        |
| 元数据持久化       | [extensions/repository.ts](../../services/coding-agent/src/adapters/extensions/repository.ts)：`ExtensionsRepository`                                                                                                        |
| Skill 文件         | [skill-files.ts](../../services/coding-agent/src/adapters/extensions/skill-files.ts)：`ManagedSkillFiles`；[skill-tool.ts](../../services/coding-agent/src/adapters/extensions/skill-tool.ts)                                |
| MCP 传输与 Pi 注册 | [transport.ts](../../services/coding-agent/src/adapters/extensions/transport.ts)、[pi-mcp.ts](../../services/coding-agent/src/adapters/extensions/pi-mcp.ts)                                                                 |
| 工具参数与结果     | [schema-validator.ts](../../services/coding-agent/src/adapters/extensions/schema-validator.ts)、[tool-evidence.ts](../../services/coding-agent/src/adapters/extensions/tool-evidence.ts)                                     |
| SecretStore        | [secret_store.py](../../services/runtime/src/mlx_studio_runtime/adapters/secret_store.py)：`KeychainSecrets`；[extension_gateway.py](../../services/runtime/src/mlx_studio_runtime/application/extension_gateway.py)         |
| 运行授权与调用账本 | [capability_grants.py](../../services/runtime/src/mlx_studio_runtime/application/capability_grants.py)、[capability_ledger.py](../../services/runtime/src/mlx_studio_runtime/adapters/persistence/capability_ledger.py)      |
| 媒体桥与 Agent     | [builtin_tool_bridge.py](../../services/runtime/src/mlx_studio_runtime/application/builtin_tool_bridge.py)、[agent-chat.ts](../../services/coding-agent/src/application/agent-chat.ts)                                       |
| 设置与选择器       | [ExtensionsSettings.vue](../../apps/desktop/src/capabilities/extensions/presentation/ExtensionsSettings.vue)、[selection-controller.ts](../../apps/desktop/src/capabilities/extensions/presentation/selection-controller.ts) |

## 配置与使用路径

统一入口为设置中的“扩展能力”，包含 Skills、MCP 服务和内置工具。管理扩展不要求创建 Coding 项目。

Skill 导入先预览正文、文件清单、依赖和目标工作区，再按预览摘要确认创建受管版本。文件适配器先复制并校验暂存包，应用层确认摘要与名称后才发布版本目录；元数据事务成功后转交文件所有权。失败时撤销本次创建的目录，不占用下一次发布的 revision，也不删除已有的相同内容版本。预览只读取暂存包并在结束时释放。正文需要名称和描述 frontmatter；脚本作为静态资源保存，不自动执行 setup 或安装步骤。

MCP stdio 配置使用已安装程序的绝对路径、参数数组和工作目录；远程 HTTP 使用 HTTPS，回环服务可使用 HTTP。公开环境变量/headers 与秘密字段分开维护，凭据只返回配置状态和引用。

保存服务产生新版本。测试连接只握手和发现目录，不调用业务工具；stdio 测试仍会启动用户指定的程序。随后审阅工具并选择白名单，只有用户核实标记为只读的工具可以在只读模式使用，服务自报 annotation 不授予权限。更新配置或白名单后需要测试对应版本。

Coding 的能力选择器可保存工作区/项目默认值，本次提交会冻结选择。普通停用或更新对后续任务生效；立即撤销会关闭相关当前与等待运行的接纳。具体模式及完全访问行为见 Coding 文档，不能只凭“非只读工具”断言每次必然弹审批。

## 运行与调度路径

1. Host 解析显式选择和默认绑定，冻结 Skill 内容版本、服务版本、工具 schema 与风险声明。
2. Host prepare 预约运行位置，Runtime 登记 pending grant，解析精确版本对应的秘密，再 commit。
3. 到队首后 activate 签发短期运行 bearer；排队期间不消耗活动授权窗口。
4. Pi 只注册选中工具，先读所选 Skill 正文，后续引用通过 `read_skill` 核对清单和摘要。
5. execute Gateway 检查快照、参数、预算和权限；transport 发包前再次核对工具、参数快照与连接代际。
6. 文字和媒体子任务独立使用 Runtime 的原有用例与推理租约。父 AgentRun 在等待工具时不持有模型锁。
7. 结果经过类型、长度与秘密过滤，再进入 Pi 和产品事件；媒体输出返回受管作品引用。

图片参考、蒙版、克隆音色使用受管 ID，不能传任意磁盘路径。作品链接可以打开原工作区查看、复用或导出，但不能据此声称文字模型已经看见图片或听见音频。

## 状态、持久化与恢复

| 数据                                                | 唯一所有者与存储                              |
| --------------------------------------------------- | --------------------------------------------- |
| Skill/MCP 版本、工具目录、绑定、撤销、mutation 回执 | Node，`coding/extensions.db`                  |
| 不可变 Skill 文件                                   | Node，`coding/skills/<id>/<contentRevision>/` |
| Agent Chat 产品记录                                 | Node，`coding/agent-chat/agent-chat.db`       |
| Agent 模型上下文                                    | Pi transcript；由 Node 保存和验证描述符       |
| 助手草稿、运行 grant 与子任务账本、媒体作品         | Python 的 Runtime 数据库和媒体目录            |
| MCP/搜索服务明文秘密                                | Python SecretStore 与 macOS Keychain          |

目录 revision 与内容 contentRevision 分离。元数据更新不会让已经启动的运行读到另一个 Skill 内容；`expectedRevision` 拒绝冲突写入。相同 mutation/submission 编号与相同意图返回原结果，不同意图冲突。

MCP 凭据的读取、查重和写入由 [extension_credentials.py](../../services/runtime/src/mlx_studio_runtime/application/extension_credentials.py) 在线程中调用同步 SecretStore，不阻塞 Supervisor 事件循环。凭据写入使用稳定的 mutation 引用；已发起的系统写入无法取消，因此保存请求被取消时继续持有保存锁，等待查重/写入实际结束后再向调用者返回取消，也不继续发布 Node 配置。重试随后复用相同暂存值或返回意图冲突，不与尚未完成的写入竞争；正常存储失败仍向调用者返回原错误。取消期间的暂存值按下述保守策略保留。

媒体创建使用 reserve → 业务 create → bind，调用编号关联稳定 submission，自动 seed 只首次生成并冻结。若 create 成功但 bind 前失败，恢复按原编号补关联，不重复生成媒体。

取消、立即撤销、到期与 Host 代际变化关闭新接纳，等待正在提交的关联完成并取消关联子 Job。重启使旧运行凭据和审批失效，只补账本关联，不重放工具。已完成作品保留；无引用版本和暂存秘密采用保守保留策略，自动 GC 不启用。

## 安全约束与能力范围

Pi 默认环境/项目扩展发现关闭，不继承全局 Skills、Prompts、可执行扩展或默认 MCP。模型与项目正文无权修改应用授权；Skill 导入不扩大项目文件工具的路径范围。

MCP JSON Schema 使用严格 draft-07 校验，不在线加载 `$ref`，未知 dialect/format 明确拒绝。结果只接纳有界文本与结构化 JSON；图片、音频、嵌入资源和服务主动请求不直接进入模型上下文。

HTTP transport 不重定向、不启动 OAuth、不自动刷新凭据或重放工具 POST。调用发送后失联应保留“结果未知”，用户需要核实远端状态。stdio 使用精简环境，不自动运行 npx/uvx 安装，不继承桌面或运行 bearer；程序本身仍以本机用户权限执行。

聊天联网开关只控制聊天资料检索，不控制 MCP 或 Coding 命令联网。秘密不能写入 Node 配置、事件或备份；只有当前选定连接的私有运行上下文获得对应秘密。

自动 Skill 激活、Git 固定 commit 导入、Skill 脚本执行、MCP Resources 内容读取、媒体结果、OAuth、Prompts、Apps UI、视觉反馈闭环和多 Agent 调度尚不能宣传为可用能力。

## 当前边界值

| 项目                      | 当前值                               | 权威来源                                                                                                                                                                                        |
| ------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模型可见工具              | 最多 16，包含基础工具和 `read_skill` | [resolver.ts](../../services/coding-agent/src/extensions/application/resolver.ts)                                                                                                               |
| 运行工具调用 / 媒体创建   | 最多 48 / 4 次                       | [tool-gateway.ts](../../services/coding-agent/src/application/tool-gateway.ts)、[capability_ledger.py](../../services/runtime/src/mlx_studio_runtime/adapters/persistence/capability_ledger.py) |
| Skill 包 / 文件数         | 20 MiB / 200                         | [skill-package.ts](../../services/coding-agent/src/adapters/extensions/skill-package.ts)                                                                                                            |
| Skill 正文 / 单次引用读取 | 64 KiB / 256 KiB                     | 同上                                                                                                                                                                                            |
| 结构化结果                | 深度 24、节点 2048，并限制序列化大小 | [transport.ts](../../services/coding-agent/src/adapters/extensions/transport.ts)                                                                                                                |

具体连接期限、预约期限和授权窗口在对应实现中维护；调整时同步覆盖排队、取消、到期、重复提交和重启测试，不能仅改 UI 提示。

## 验证命令与维护

```bash
pnpm generate rpc
pnpm generate api
pnpm check
pnpm test coding
pnpm test runtime
pnpm build coding-bundle
```

执行目录为仓库根目录。重点测试：[extensions](../../services/coding-agent/tests/extensions.test.mjs)、[Skill 发布回滚](../../services/coding-agent/tests/skill-publication.test.mjs)、[pi-extensions](../../services/coding-agent/tests/pi-extensions.test.mjs)、[管理 API](../../tests/test_extension_api.py)、[凭据异步与取消边界](../../tests/test_extension_secret_boundary.py)、[运行授权](../../tests/test_extension_capabilities.py)、[跨模态工作流](../../tests/test_extension_workflows.py)。这些测试使用受控服务、FakeEngine 或秘密替身，不读取用户 Keychain。

真实 MCP、签名身份下的 Keychain、真实媒体模型与最终包内资源需单独验证。维护变更时更新本页对应路径与限制，将实际结果集中记录到[验证范围](../verification.md)；函数长度例外统一维护在[代码规范](../code-standards.md)，不藏在功能验收记录中。
