<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.png" width="96" alt="Ownloom 图标">
</p>

# Ownloom

**运行在 Apple Silicon 上的本地 AI 工作台。**

在同一个桌面应用中使用本地模型聊天、创作图片和语音、开发代码。Ownloom 使用 Vue 界面、Tauri 桌面壳和独立的 MLX 推理进程，并通过 Pi 提供 Coding 与工具工作区。

[English](README.md) · **简体中文** · [文档](docs/README.md) · [参与贡献](docs/contributors.md) · [许可证](LICENSE)

## 项目状态

Ownloom 目前是面向 **Apple Silicon macOS** 的开发预览项目，可按下文从源码启动。兼容性取决于模型、适配器和可用内存；带有 MLX 标签或下载成功并不代表模型一定可用。

仓库提供自动化检查和打包应用验收工具。正式签名、公证、独立干净机器测试和长期稳定性验收仍是单独的发布要求。已记录的证据与剩余限制见[验证矩阵](docs/verification.md)。

## 可以做什么

| 工作区     | 能力                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| 聊天       | 本地流式回答、会话历史、停止与重新生成，以及模型兼容的图片或文档附件。       |
| 模型库     | 从 Hugging Face 发现和下载模型，导入本地目录，管理加载状态和存储。           |
| 图片创作   | 使用支持的模型进行文生图、参考图编辑与局部重绘，保存和复用作品。             |
| 语音创作   | 使用 Qwen3-TTS 预设音色或参考音频克隆，管理音色库，导出 WAV 音频。           |
| Coding     | 通过 Pi 在本地项目中工作，查看工具活动与变更，审批受保护操作，检查验证证据。 |
| 扩展能力   | 为支持的 Agent 工作流配置受管 Skills、MCP 连接和本地工具。                   |
| 任务与数据 | 跨工作区观察任务，查看诊断，显式备份、恢复或清理应用数据。                   |

可选联网搜索使用已配置的 Tavily 兼容服务，来源随回答保存。文档支持有文本层的 PDF、DOCX、TXT 和 Markdown；当前不提供扫描 PDF 所需的 OCR。操作与兼容范围见[用户手册](docs/reference.md)。

## 快速开始

准备 **Node.js 22（至少 22.19.0）**、**pnpm 11.11.0**、**uv**、**Python 3.12**、**Rust** 和 macOS 命令行开发工具。详细前置条件与其他开发方式见[开发指南](docs/development.md)。

```bash
git clone https://github.com/h-yu-u/MlxDesktop.git
cd MlxDesktop
nvm use
UV_PYTHON=3.12 pnpm bootstrap
UV_NO_SYNC=1 pnpm dev
```

`nvm use` 适用于 nvm 用户；使用其他版本管理器时请选择 Node.js 22。`UV_PYTHON=3.12` 选择所需的 Python 版本，`bootstrap` 安装锁定的依赖和可选推理包。`UV_NO_SYNC=1` 让桌面启动开发 Runtime 时保留已准备的环境，包括音频依赖。依赖变化后，先重新运行 `UV_PYTHON=3.12 pnpm bootstrap` 再启动。

打开**模型库**，下载或导入兼容的本地模型，再到对应工作区选择模型。仓库不包含权重，首次安装依赖和下载模型需要网络。正常启动的模型库为空；FakeEngine 仅用于隔离开发和测试。

`pnpm dev:web` 只启动前端。浏览器开发还需要单独配置 Runtime，步骤见[开发指南](docs/development.md)。

## 系统组成

| 部分                               | 职责                                                   |
| ---------------------------------- | ------------------------------------------------------ |
| Vue 3、TypeScript、Pinia、Naive UI | 工作区、交互与展示；通过应用端口隔离平台访问。         |
| Tauri 2 / Rust                     | 原生对话框、Runtime 认证启动和进程生命周期。           |
| Python / FastAPI Supervisor        | 产品 API、任务调度、模型管理和应用数据。               |
| 独立推理 Worker                    | MLX 文本/视觉、MFLUX 图片和 MLX Audio 语音适配器。     |
| Node.js / Pi Host                  | Coding 与 Agent 执行、审批、扩展及其独立负责的持久化。 |

[架构规范](docs/architecture.md)定义系统不变量；[子系统参考](docs/subsystems/README.md)描述当前运行路径、契约和失败行为。

## 隐私与外部服务

本地推理使用本机文件。可选联网搜索会把搜索问题发送给配置的服务，模型下载访问 Hugging Face，启用的 MCP 工具可能连接对应服务器。处理敏感项目之前，请检查工具访问范围和审批配置。

桌面 Runtime 监听回环地址并使用会话认证，API 边界和当前限制见 [Runtime 参考](docs/subsystems/runtime.md)。凭据与备份内容采用不同的存储规则，移动或分享数据前请阅读[用户手册](docs/reference.md)和[存储参考](docs/subsystems/storage.md)。本地运行并不意味着所有可选流程都能离线。

## 开发与贡献

先阅读[开发指南](docs/development.md)、[编码规范](docs/code-standards.md)和相关子系统参考。主要检查命令为：

```bash
pnpm check
pnpm test
```

`pnpm check` 包含文档检查。测试通过不能代替真实模型兼容性或发布验收；这些检查分别记录。

欢迎通过 [GitHub Issues](https://github.com/h-yu-u/MlxDesktop/issues) 和 Pull Request 提交可复现的问题与聚焦的改进。请附复现步骤、验证的提交版本、检查结果和未验证范围，并遵守[贡献指南](docs/contributors.md)。AI 编程助手从 [AGENTS.md](AGENTS.md) 开始。

## 文档

- [用户手册](docs/reference.md)：工作区、配置和本地数据。
- [开发指南](docs/development.md)：环境、命令和生成流程。
- [架构规范](docs/architecture.md)与[编码规范](docs/code-standards.md)：长期设计与评审规则。
- [子系统参考](docs/subsystems/README.md)：持续维护的实现说明。
- [验证矩阵](docs/verification.md)与[发布验收](docs/release-acceptance.md)：证据、限制和可重复执行的发布检查。
- [经验记录](LESSONS.md)：有证据的发现及其晋升规范的规则。

## 许可证与致谢

Ownloom 的代码和文档使用 [MIT License](LICENSE)，版权归 © 2026 h-yu-u 所有。依赖与模型权重遵循各自的许可证；本项目许可证不授予下载模型或外部服务的使用权。

Ownloom 基于 MLX 生态、Tauri、Vue、Naive UI、Pi 和 Tavily SDK 构建。文档维护方式参考 [Magpie](https://github.com/yetone/magpie)：精简的 Agent 入口、有证据的经验记录、稳定编码规范及各子系统负责的设计参考。具体实现与验证结论均以 Ownloom 的源码为依据。
