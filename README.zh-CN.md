<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.png" width="96" alt="Ownloom 图标">
</p>

# Ownloom

**运行在 Apple Silicon 上的本地 AI 工作台。**

在同一个桌面应用中使用本地模型聊天、创作图片和语音、开发代码。下载兼容模型，带上自己的文件与项目，把会话和作品保存在 Mac 上。

[English](README.md) · **简体中文** · [文档](docs/README.md) · [参与贡献](docs/contributors.md) · [许可证](LICENSE)

## 快速开始

需要一台 **Apple Silicon Mac**。模型权重需另行下载，请选择适合可用内存的模型。

### 1. 安装

[下载 Apple Silicon 版 Ownloom](https://github.com/h-yu-u/Ownloom/releases/latest/download/ownloom-darwin-arm64.dmg)，打开 DMG，将 **Ownloom.app** 拖入**应用程序**。版本说明与校验文件见 [Releases](https://github.com/h-yu-u/Ownloom/releases/latest)。

也可以在终端安装：

```sh
curl -fsSL https://github.com/h-yu-u/Ownloom/releases/latest/download/install.sh | sh
```

### 2. 打开 Ownloom

通过 Finder 或 Spotlight 打开已安装的 **Ownloom**。

当前安装包使用 ad-hoc 签名，未经过 Apple 公证。如果首次打开被 macOS 阻止，可能需要在**系统设置 → 隐私与安全性**中手动允许 Ownloom。

### 3. 添加模型，开始聊天

打开**模型库**，点击**发现模型**，从 Hugging Face 下载兼容的 MLX 模型。已有完整模型文件夹时，点击**导入本地模型**并选择该目录。

模型就绪后，进入**聊天**，选择文本模型并发送第一条消息；首次请求会准备模型。使用图片创作、语音创作或 Coding 时，在相应工作区选择具备对应能力的模型。

兼容性取决于模型导出格式、适配器和可用内存；带有 MLX 标签或下载成功并不代表模型一定可用。模型选择、各工作区和本地数据的操作说明见[用户手册](docs/reference.md)。

## 可以做什么

| 工作区     | 能力                                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| 聊天       | 本地流式回答、会话历史与原生生成统计、停止与重新生成，以及模型兼容的图片或文档附件。 |
| 模型库     | 从 Hugging Face 发现和下载模型，导入本地目录，管理加载状态和存储。                   |
| 图片创作   | 使用支持的模型进行文生图、参考图编辑与局部重绘，保存和复用作品。                     |
| 语音创作   | 使用 Qwen3-TTS 预设音色或参考音频克隆，管理音色库，导出 WAV 音频。                   |
| Coding     | 通过 Pi 在本地项目中工作，查看工具活动与变更，审批受保护操作，检查验证证据。         |
| 扩展能力   | 为支持的 Agent 工作流配置受管 Skills、MCP 连接和本地工具。                           |
| 任务与数据 | 跨工作区观察任务，查看诊断，显式备份、恢复或清理应用数据。                           |

可选联网搜索使用已配置的 Tavily 兼容服务，来源随回答保存。文档支持有文本层的 PDF、DOCX、TXT 和 Markdown；当前不提供扫描 PDF 所需的 OCR。操作与兼容范围见[用户手册](docs/reference.md)。

## 隐私与外部服务

本地推理使用本机文件。可选联网搜索会把搜索问题发送给配置的服务，模型下载访问 Hugging Face，启用的 MCP 工具可能连接对应服务器。处理敏感项目之前，请检查工具访问范围和审批配置。

桌面 Runtime 监听回环地址并使用会话认证，API 边界和当前限制见 [Runtime 参考](docs/subsystems/runtime.md)。凭据与备份内容采用不同的存储规则，移动或分享数据前请阅读[用户手册](docs/reference.md)和[存储参考](docs/subsystems/storage.md)。本地运行并不意味着所有可选流程都能离线。

## 社区与贡献

欢迎通过 [GitHub Issues](https://github.com/h-yu-u/Ownloom/issues) 报告问题、提出建议或分享可复现的模型兼容性结果。请提供应用版本、Mac 型号、模型来源和复现步骤，分享日志前先移除个人数据。

从源码开发或提交 Pull Request，请从[贡献指南](docs/contributors.md)开始；工具链准备、桌面与浏览器开发、检查和测试命令统一见[开发指南](docs/development.md)。设计和评审约定见[架构规范](docs/architecture.md)、[编码规范](docs/code-standards.md)与[子系统参考](docs/subsystems/README.md)。AI 编程助手从 [AGENTS.md](AGENTS.md) 开始。

## 兼容性与发布状态

模型支持与发布检查的证据统一记录在[验证矩阵](docs/verification.md)。自动测试和包内启动检查覆盖特定路径，不能代替所有模型的兼容性、原生 GUI/Gatekeeper 或独立干净机器验收。Developer ID 签名与公证仍需单独完成。

## 文档

- [用户手册](docs/reference.md)：工作区、配置和本地数据。
- [开发指南](docs/development.md)：环境、命令和生成流程。
- [架构规范](docs/architecture.md)与[编码规范](docs/code-standards.md)：长期设计与评审规则。
- [子系统参考](docs/subsystems/README.md)：持续维护的实现说明。
- [验证矩阵](docs/verification.md)与[发布验收](docs/release-acceptance.md)：证据、限制和可重复执行的发布检查。
- [版本发布](docs/release.md)：标签触发的构建、包内启动检查、正式发布及 Latest 设置。
- [经验记录](LESSONS.md)：有证据的发现及其晋升规范的规则。

## 许可证与致谢

Ownloom 的代码和文档使用 [MIT License](LICENSE)，版权归 © 2026 h-yu-u 所有。依赖与模型权重遵循各自的许可证；本项目许可证不授予下载模型或外部服务的使用权。

Ownloom 基于 MLX 生态、Tauri、Vue、Naive UI、Pi 和 Tavily SDK 构建。文档维护方式参考 [Magpie](https://github.com/yetone/magpie)：精简的 Agent 入口、有证据的经验记录、稳定编码规范及各子系统负责的设计参考。具体实现与验证结论均以 Ownloom 的源码为依据。
