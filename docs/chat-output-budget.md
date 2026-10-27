# 普通聊天的回答长度

默认使用“自动最大”，发送与重新生成请求的 `max_tokens` 为 `null`；“重置”也恢复自动模式。旧客户端仍可传正整数，普通聊天接口和文本 Worker 不再把输出固定限制在 8192。

## 上下文与输出

上下文包含系统提示、用户输入、历史、附件/网页资料、视觉输入及输出，并不是可以全部作为回答长度。自动模式先用合理的最低输出预留选择资料、压缩历史，再根据最终输入计算剩余输出空间，避免为完整窗口预留输出而让输入没有空间。

快照中的预算明确为估计值。文本/视觉文本适配器渲染实际 chat template 后，用 tokenizer 重新计算输入占用；自动模式将剩余空间交给引擎，保留 128 tokens 安全余量。视觉输入继续使用已有的每图 2048 tokens 估计，不把它描述为精确的视觉 token 计量。显式手动值超过当前剩余窗口时仍报上下文不足。

手动设置框的范围来自模型 `contextLength` 并扣除安全余量，不按模型名称分支。切换为手动时提供 8192 的起始值（小窗口相应缩小），这个值不再是上限。没有模型窗口元数据时沿用 8192 的保守窗口估计，不推断百万级能力。Coding/Agent 的独立推理预算不在此次普通聊天变更范围内。

## 当前本地模型核对

2026-10-27 只读检查本机登记的 `Qwen3.8-27B-Uncensored-MLX · 4-bit`：`contextLength` 与本地 `text_config.max_position_embeddings` 均为 262144，RoPE 类型为 `default`，`generation_config.json` 没有声明独立输出上限。

[Qwen 官方模型说明](https://huggingface.co/Qwen/Qwen3.8-27B#best-practices)区分原生 262144 上下文与通过 YaRN 配置扩展的百万上下文，也分别讨论推理内容和最终回复的生成长度。此次没有改写模型配置或启用百万级扩展，不能因模型名称或云端规格而宣称本地已经支持 1M。

## 修改与验证

- 界面：`ChatInspector.vue`、其样式、`chat-parameters.ts`，展示自动/手动模式并容纳较大的数字。
- 请求：`chat-controller.ts`、`chat-attempts.ts`、`submit-chat.ts`，传递自动模式且重置时恢复。
- 契约：HTTP `contracts.py`、`chat_contracts.py` 与重新生成的 `generated-schema.d.ts`，允许空值表示自动，正整数表示手动。
- 准备：`chat_context.py`、`context_compaction.py`、`chat_preparation.py`，自动模式不为整个窗口提前预留输出，复用资料时重新计算预算。
- 推理：`chat_service.py`、`model_runtime.py`、`ports.py`、`worker_host.py`、文本引擎 `session.py`，空值贯通到引擎并移除 8192 截断；旧会话参数仍可复用。
- 回归：面板默认模式与手动大数、重置/请求、262144 与小窗口的预算、真实模板计量边界、显式输出不被截成 8192，以及 Fake Worker 下发送、持久化和复用上下文。

没有新增依赖。普通聊天代码需要重启开发 Runtime 与刷新页面才能完整生效；安装的应用需要重新构建。真实 MLX 长输出、长上下文稳定性、正式签名发行包与干净机器仍未通过本次验证。

2026-10-27 验证：`pnpm api:generate`、`pnpm check`、`pnpm test` 通过；前端 262、Runtime 214、Coding 53、验收工具 8，共 537 项测试。Fake Worker 的普通发送与资料复用已完成到成功终态，自动模式作为空值持久化；适配器的计量测试覆盖 262144 窗口、手动 131072、视觉预留和输入溢出。该结果不能代替真实模型生成十万 tokens 的稳定性验收。
