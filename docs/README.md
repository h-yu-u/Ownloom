# Ownloom 文档

Ownloom 是面向 Apple Silicon macOS 的本地 AI 工作台，包含模型管理、流式聊天、图片创作、语音创作、Coding 和本地历史记录。

产品原名 MLX Studio，现统一使用 Ownloom；新构建的应用包为 `Ownloom.app`，窗口、界面、图标和导出文件使用新品牌。应用标识、历史数据目录、Keychain 命名空间及内部协议标识保持兼容，原会话、模型登记、作品和已保存凭据可继续使用。历史验收文档中的旧应用名称和制品路径保留当时记录；数据兼容范围见[使用与开发](./getting-started.md#数据位置)。

## 阅读入口

| 文档 | 内容 |
|---|---|
| [使用与开发](./getting-started.md) | 环境准备、启动、模型下载、聊天、生图历史、常用命令 |
| [聊天附件与联网搜索](./chat-attachments-web.md) | 文档解析、草稿、来源、回答尝试、迁移、调度与验证范围 |
| [Coding 工作区](./coding.md) | Pi 接入、项目开发、权限审批、变更与验证、复验命令 |
| [Skills、MCP 与本地工具](./extensions.md) | 扩展设置、受管 Skill、工具授权、文字助手、Agent Chat、媒体桥与验证边界 |
| [语音创作](./audio-studio.md) | 预设合成、参考克隆、音色库、作品与 WAV 导出、依赖及验收范围 |
| [架构](./architecture.md) | 进程职责、通信、模型能力、任务生命周期、存储与安全决策 |
| [交互一致性与共享 UI](./ux-consistency.md) | 草稿与提交、导出结果、设置与媒体恢复、共享组件及验证边界 |
| [工程规范](./engineering.md) | 分层、编码约束、依赖、测试与完成标准 |
| [验收状态与后续工作](./status.md) | 已实现范围、真实模型验证、复验命令、待完成事项 |
| [安装与稳定性验收](./release-acceptance.md) | 临时签名分发、本机隔离、真实模型持续循环、干净机器检查单与可携带工具 |
| [架构决策 0001](./adr/0001-runtime-boundaries.md) | 依赖装配、状态所有权、任务与持久化边界 |
| [2026-10-15 重构验收](./refactor-2026-10-15.md) | 阶段 0–8 交付、旧入口退场、迁移与本机验证证据 |

## 事实来源与维护

- 开发命令以根目录 [package.json](../package.json) 为准。
- 模型验证环境、已通过场景和未验证范围统一维护在[验收状态](./status.md)。
- HTTP DTO 以 FastAPI OpenAPI 为准，生成到 [API 客户端类型](../packages/api-client/src/generated-schema.d.ts)。
- AI 助手遵循根目录 [AGENTS.md](../AGENTS.md) 和其引用的工程规范。

项目 Markdown 除 `AGENTS.md` 外统一放在本目录。功能变化直接更新对应文档；一次性的排查过程、临时修复清单、旧环境安装失败记录不另建长期文档。新增架构决策先补充架构文档；已实施功能与计划、自动化检查与真机验收分别描述。
