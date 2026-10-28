# 聊天、附件与联网

[子系统索引](README.md) · [用户手册](../reference.md) · [验证矩阵](../verification.md)

## 职责与边界

普通聊天拥有会话、草稿、消息、回答尝试和所用资料快照。附件服务拥有原件及不可变准备结果；联网服务拥有配置版本与来源获取。聊天通过 [Runtime](runtime.md) 提交推理，不直接管理 Worker；数据库和文件引用的整体规则见[存储](storage.md)。

普通聊天不默认启用工具或工作区扩展。独立工具助手、文字助手和工具执行走[扩展能力](extensions.md)的授权路径，不能把普通附件问答隐式升级为可执行 Agent。

## 事实来源

| 责任                   | 源码与符号                                                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 草稿、提交与回答尝试   | [chat-controller.ts](../../apps/desktop/src/modules/chat/presentation/chat-controller.ts)、[chat-attempts.ts](../../apps/desktop/src/modules/chat/presentation/chat-attempts.ts)、[submit-chat.ts](../../apps/desktop/src/modules/chat/application/submit-chat.ts)                                  |
| 接纳、幂等、事务与推理 | [ChatAdmission](../../services/runtime/src/mlx_studio_runtime/application/chat_admission.py)、[ChatService](../../services/runtime/src/mlx_studio_runtime/application/chat_service.py)                                                                                                              |
| 上下文与压缩           | [ChatPreparation](../../services/runtime/src/mlx_studio_runtime/application/chat_preparation.py)、[chat_context.py](../../services/runtime/src/mlx_studio_runtime/domain/chat_context.py)、[context_compaction.py](../../services/runtime/src/mlx_studio_runtime/application/context_compaction.py) |
| 输出窗口               | [chatOutputLimit](../../apps/desktop/src/modules/chat/domain/chat-parameters.ts)、[ContextBudget](../../services/runtime/src/mlx_studio_runtime/domain/context_budget.py)、[EngineSession.\_check_budget](../../services/runtime/src/mlx_studio_runtime/adapters/text_engines/session.py)           |
| 附件格式与准备         | [attachments.py](../../services/runtime/src/mlx_studio_runtime/domain/attachments.py)、[准备执行器](../../services/runtime/src/mlx_studio_runtime/adapters/attachment_preparation_executor.py)、[文档提取器](../../services/runtime/src/mlx_studio_runtime/adapters/document_extractors/)           |
| 搜索与日期             | [WebRetrieval](../../services/runtime/src/mlx_studio_runtime/application/web_retrieval.py)、[Tavily](../../services/runtime/src/mlx_studio_runtime/adapters/web/tavily.py)、[web_freshness.py](../../services/runtime/src/mlx_studio_runtime/domain/web_freshness.py)                               |
| URL 与响应边界         | [url_policy.py](../../services/runtime/src/mlx_studio_runtime/adapters/web/url_policy.py)、[bounded_transport.py](../../services/runtime/src/mlx_studio_runtime/adapters/web/bounded_transport.py)、[web.py](../../services/runtime/src/mlx_studio_runtime/domain/web.py)                           |
| 来源呈现               | [MessageSources.vue](../../apps/desktop/src/modules/chat/components/MessageSources.vue)、[message-source.ts](../../apps/desktop/src/modules/chat/domain/message-source.ts)                                                                                                                          |

## 运行路径与回答状态

1. 桌面冻结本次提交参数、附件选择及请求 ID。上传、解析和模型兼容性各自显示状态；某项失败不重复上传其他已经成功的原件。
2. `ChatAdmission` 按会话串行处理接纳，等待 Skills RPC 时也保留该会话的接纳锁，其他会话不受影响。先检查同一请求 ID 的摘要；相同输入返回已有任务，不同输入返回冲突。随后核对会话、模型、附件版本和不可变搜索配置，异步检查后再次确认会话与模型可用，再在事务中接纳。每个会话只允许一个非终态 ChatJob，数据库唯一索引仍作最终保护。接纳失败会撤回本次临时技能绑定；文字助手使用同样的失败补偿，避免将未入库的 Job 留在撤销列表中。
3. `schedule_prepared` 在父任务的推理租约外准备文档、搜索来源和上下文。文档及网页 I/O 不占模型租约；需要历史摘要时，摘要通过独立推理 Job 取得同一租约，完成后父任务再排队生成回答。
4. Worker 渲染真实模板并校验预算，流式返回文本。上下文不足且尚未产生文本时，适用请求最多重建一次上下文；不能无界重试或覆盖已展示的生成结果。
5. 推理结束并释放租约后，回答与成功终态按用例事务提交。取消先取得终态资格时，不再提交新的成功回答。SSE/JobObserver 使用快照恢复，文字版本和阶段版本分开处理。

聊天界面中，普通回答重新生成优先复用已有资料快照；联网回答重新生成会再次检索。新尝试沿用原用户消息，成功后替换当前回答，失败保留旧回答及来源。传输重试复用冻结请求，与用户主动重新生成是不同操作。

达到输出上限与推理失败分别保存；仅最后一条因长度结束的回答提供“继续回答”。自动标题取首条非空用户输入的前七个字符并归一化空白，用户手动命名优先；相关规则由[会话标题领域函数](../../services/runtime/src/mlx_studio_runtime/domain/conversation_title.py)维护。共享侧栏与输入交互归属[桌面](desktop.md)。

## 输出预算

普通聊天的 `max_tokens = null` 表示“自动最大”，重置也恢复该模式。准备阶段先用有限输出预留挑选资料、压缩历史；真正生成前使用渲染后的模板和 tokenizer 重新计算输入，剩余窗口扣除 128 token 安全余量后作为输出上限。自动模式允许模型提前结束。

正整数表示手动输出值。手动输入框根据模型 `contextLength` 计算范围，8192 只是切换手动时的起始值；缺少窗口元数据时也采用 8192 的保守估计。实际输入加输出超过可用窗口仍然失败，不能根据界面范围推断请求一定被接纳。

普通聊天保存的快照预算是估计值；生成前对文本模板执行实际 tokenizer 复核。视觉输入仍使用每图 2048 token 的估计，不能宣称精确计量。模型窗口、最大回答长度与已验证的长上下文稳定性是不同事实。Coding/Agent 的独立窗口规则见 [Coding](coding.md)。

## 附件准备与来源

当前格式为 PNG/JPEG/WebP/GIF、UTF-8 TXT/Markdown、DOCX 和有文本层的 PDF。GIF 取首帧；DOCX 提取正文及常见表格；PDF 保留真实页码与不可读页。当前不执行 OCR，超出预算的全文总结明确拒绝，不能用部分片段冒充完整文档。仅含附件的问答可以没有正文；数据库保留用户原始空文字，默认概括提示只进入模型上下文。

当前附件限制由 `domain/attachments.py` 定义：每条消息最多 8 个、单文件 20 MiB、总计 60 MiB。视觉输入数量另受 Manifest 的 `inputLimits.maxImages` 约束，文档不占图片名额。切换模型保留草稿选择并提示不兼容项。

准备执行器使用受管理子进程并约束并发、时间、页数、解压后大小、像素和输出量；取消或超时需要终止并回收子进程。macOS 的轮询内存检查不能当作操作系统硬 RSS 上限。原件按流计算 hash，派生结果原子发布且版本不可变，读取时检查完整性。

回答冻结实际使用的历史、文档位置、视觉组、网页内容、预算与来源。来源标记只在该条回答保存的映射中解析，代码块和行内代码不转换引用。网页链接通过平台适配器打开，文档来源预览实际已提取内容；导出保留来源名称、位置、地址与检索时间。

附件引用、草稿租约、迁移回填、显式清理和恢复由[存储参考](storage.md)维护；自动 GC 当前关闭。历史图片复用默认关闭，不能将本轮图片输入自动扩展为全历史视觉上下文。

## 联网行为与失败边界

联网默认关闭并按会话保留选择。关闭路径不发起搜索、网页正文提取或搜索凭据解析；重新生成仍可读取已保存的来源快照。启用时需要明确用户问题与已保存配置；服务必须兼容 Tavily Search/Extract 协议。当前适配器调用官方 `AsyncTavilyClient.search` / `extract`，固定依赖见 [pyproject.toml](../../services/runtime/pyproject.toml)。

Search 保留原问题，时效性问题独立提供 day/week 参数，使用 `advanced` 深度，不使用供应商生成的答案。只有时效性检索经日期过滤后没有候选时，最多移除时间限制再搜索一次；正文提取失败不触发这一回退。认证、额度、网络错误不伪装成空结果。时效性来源按当天、近期、日期未知排序，排除明确过旧或未来的来源；普通历史问题不强加“最近一周”过滤。

整个检索受配置总时限约束（当前默认 30 秒），SDK 单请求至多 12 秒；选择最多 3 个来源，正文提取并发 2。传输限制解码后响应为 2 MiB，禁用重定向和环境代理。具体常量属于此实现，不是永久的系统设计上限。

引用地址校验与正文提取授权分开：公网格式的摘要可保留为 `snippet_only`，正文提取还要求 DNS 公网校验。代理 Fake-IP 或解析失败不会放行正文读取。来源区区分 `page_excerpt` 与 `snippet_only`；没有任何可用来源返回 `WEB_NO_RESULTS`，不能让模型凭记忆补实时事实。

密钥由 Keychain 保存，数据库持有不可变配置 revision 和秘密引用。任务绑定接纳时的 revision；配置入库失败时仅删除本次新建的秘密引用，保留既有引用。凭据不能进入 Worker、提示词、公开结果或来源快照。当前未实现 SearXNG、任意网页爬虫或模型驱动的多轮搜索规划。

## 上游与许可

实际使用 [Tavily Python SDK](https://github.com/tavily-ai/tavily-python)，遵循其 [MIT 许可](https://github.com/tavily-ai/tavily-python/blob/46505f119e6ac0f30d63a4dce0ed9f923705ad97/LICENSE)。搜索参数和 Search/Extract 组合方式参考 [LibreChat agents](https://github.com/LibreChat-AI/agents/blob/c56fc5eb7d141a25976c1886520ab4dac745ae07/src/tools/search/tavily-search.ts)及其 [MIT 许可](https://github.com/LibreChat-AI/agents/blob/c56fc5eb7d141a25976c1886520ab4dac745ae07/LICENSE)，未引入整个 Agent 框架。`advanced` 查询及有限重试可能产生服务费用，配置测试也会真实调用服务。

## 验证入口

在根目录运行 `pnpm test frontend`、`pnpm test runtime`；改变 HTTP 契约时运行 `pnpm generate api` 并检查生成 diff，完整命令见[开发指南](../development.md)。

重点回归包括[请求与完成](../../tests/test_chat_completion.py)、[上下文与尝试](../../tests/test_chat_context.py)、[附件准备](../../tests/test_attachment_preparation.py)、[准备调度](../../tests/test_chat_preparation_scheduler.py)、[Tavily SDK](../../tests/test_tavily_sdk.py)、[日期过滤](../../tests/test_web_freshness.py)及[来源 URL](../../tests/test_web_reference_urls.py)。前端组件与 controller 测试位于同名 `.spec.ts`。

这些测试不证明真实 VLM 历史视觉绑定、真实长输出质量、搜索正文完整网络矩阵、正式签名下 Keychain 或干净机器可用。已记录验证的范围及剩余要求统一见[验证矩阵](../verification.md)。
