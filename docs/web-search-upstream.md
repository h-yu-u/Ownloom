# 联网搜索上游与适配

2026-10-27 改为实际调用 Tavily 官方开源 SDK，替代自写 Search/Extract HTTP 请求。生产依赖固定为 `tavily-python==0.8.5`，由 uv 锁定；新增传递依赖为 `tiktoken`，Search/Extract 不调用 SDK 的上下文生成或 tokenizer 下载功能。已有 `httpx` 仅作为 SDK 的受限传输边界。

## 开源来源

- 实际复用：[Tavily Python SDK](https://github.com/tavily-ai/tavily-python)，[MIT 许可证](https://github.com/tavily-ai/tavily-python/blob/46505f119e6ac0f30d63a4dce0ed9f923705ad97/LICENSE)。调用 `AsyncTavilyClient.search` 与 `extract`；不复制或维护供应商 HTTP 协议实现。
- 流程参考：[LibreChat agents 的 Tavily 集成](https://github.com/LibreChat-AI/agents/blob/c56fc5eb7d141a25976c1886520ab4dac745ae07/src/tools/search/tavily-search.ts)，[MIT 许可证](https://github.com/LibreChat-AI/agents/blob/c56fc5eb7d141a25976c1886520ab4dac745ae07/LICENSE)。沿用问题与日期参数分离、可选相对时间范围、Search 后提取来源的方式；未复制其 TypeScript 源码或引入整个 Agent 框架。

## 本项目保留的边界

本地模型负责回答；Keychain 凭据、不可变配置 revision、URL 校验、引用、任务取消和上下文快照继续由现有 Runtime 管理。凭据通过构造参数交给 SDK，空凭据直接拒绝，不使用 SDK 的 keyless 模式。自定义兼容服务的 origin 与路径保留，重定向不会转发密钥。

日期不再作为“今天发布才准回答”的硬门槛。按本地日历优先选择当天、近期和日期未知的来源，明确陈旧或未来来源排除。首次检索没有可用候选时，SDK 最多重试一次无时间限制的检索；错误响应不伪装为空结果。模型收到真实发布时间、检索时间与摘要/正文标记，必须按证据范围表达。

SDK 使用 `advanced` 搜索，可能比之前默认的 basic 模式消耗更多服务额度；最多两次请求，仍受整个检索流程 30 秒总时限约束。未实现模型驱动的多轮查询规划、跨供应商检索或通用网页爬虫。

## 验证

自动化通过真实 SDK 和模拟 HTTP 边界验证原问题不改写、独立日期参数、无结果/仅旧结果后的单次回退、自定义服务路径、Search/Extract、鉴权/额度/超时、取消、压缩响应、响应上限与错误脱敏。端到端准备测试继续覆盖普通聊天不加载工具、来源持久化、失败保留旧回答、代理 DNS 下的摘要保留及私网拒绝。

真实服务与完整检查结果记录在[聊天附件与联网搜索](./chat-attachments-web.md)的验证范围中。FakeEngine 验证不代表真实 MLX 模型、正式签名或干净机器验收通过。

## 修改文件

| 文件 | 内容 |
|---|---|
| `services/runtime/src/mlx_studio_runtime/adapters/web/tavily.py` | 实际调用官方 SDK、有限回退及错误映射 |
| `services/runtime/src/mlx_studio_runtime/adapters/web/bounded_transport.py` | SDK 响应大小与解码边界 |
| `services/runtime/src/mlx_studio_runtime/domain/web_freshness.py` | 当天、近期、日期未知来源排序 |
| `services/runtime/src/mlx_studio_runtime/application/web_retrieval.py` | 采用来源排序，移除严格当日拦截 |
| `services/runtime/src/mlx_studio_runtime/domain/chat_context.py` | 日期、缩写与研究结论的证据表达 |
| `services/runtime/pyproject.toml`、`services/runtime/uv.lock` | 固定 SDK 依赖；未升级现有依赖 |
| `scripts/build-runtime.sh` | 将 SDK 与传递依赖加入 sidecar |
| `tests/test_tavily_sdk.py`、`tests/test_web_freshness.py`、`tests/test_web_retrieval.py` | SDK 边界、日期与集成回归 |
| `docs/chat-attachments-web.md`、本文 | 使用行为、上游来源与验收证据 |

开发 Runtime 重新启动后加载新依赖与代码；已安装的发行应用需要重新构建。此次没有提交 Git commit，也没有更改用户的搜索配置或凭据。
