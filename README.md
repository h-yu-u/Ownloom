<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.png" width="96" alt="Ownloom icon">
</p>

# Ownloom

**Your local AI workspace on Apple Silicon.**

Chat with local models, create images and speech, and work on code in one desktop application. Download compatible models, bring your own files and projects, and keep your conversations and creations on your Mac.

**English** · [简体中文](README.zh-CN.md) · [Documentation](docs/README.md) · [Contributing](docs/contributors.md) · [License](LICENSE)

## Quick start

You need an **Apple Silicon Mac**. Model weights are downloaded separately; choose models that fit your available memory.

### 1. Install

[Download Ownloom for Apple Silicon](https://github.com/h-yu-u/Ownloom/releases/latest/download/ownloom-darwin-arm64.dmg), open the DMG, and drag **Ownloom.app** to **Applications**. See [Releases](https://github.com/h-yu-u/Ownloom/releases/latest) for release notes and checksums.

Or install from Terminal:

```sh
curl -fsSL https://github.com/h-yu-u/Ownloom/releases/latest/download/install.sh | sh
```

### 2. Open Ownloom

Launch the installed **Ownloom** app from Finder or Spotlight.

Current builds are ad-hoc signed and not Apple notarized. If macOS blocks the first launch, you may need to allow Ownloom in **System Settings → Privacy & Security**.

### 3. Add a model and start chatting

Open **Model library (模型库)** and choose **Discover models (发现模型)** to download a compatible MLX model from Hugging Face. If you already have a complete model folder, choose **Import local model (导入本地模型)**.

Once the model is available, open **Chat (聊天)**, select a text model, and send your first message. Ownloom prepares the model on the first request. For images, speech or Coding, choose a model with the corresponding capabilities in that workspace.

Compatibility depends on the model's export format, adapter and available memory; an MLX label or a successful download does not guarantee support. The [user guide](docs/reference.md) explains model selection, workspaces and local data.

## What you can do

| Workspace       | Capabilities                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Chat            | Stream local responses, keep conversation history, stop or regenerate a response, and use compatible image or document attachments.    |
| Model library   | Discover and download models from Hugging Face, import local directories, and manage loading and storage.                              |
| Image creation  | Generate images, edit with reference images and use masked editing with supported models; save and reuse works.                        |
| Speech creation | Use Qwen3-TTS preset voices or reference-based cloning, manage voice profiles, and export WAV audio.                                   |
| Coding          | Work in a local project through Pi, review tool activity and changes, approve protected operations, and inspect verification evidence. |
| Extensions      | Configure managed Skills, MCP connections and local tools for supported agent workflows.                                               |
| Tasks and data  | Follow tasks across workspaces, inspect diagnostics, and explicitly back up, restore or clean application data.                        |

Optional web search uses a configured Tavily-compatible service and preserves sources with the answer. Text-layer PDF, DOCX, TXT and Markdown are supported; scanned PDFs require OCR that is not currently provided. See the [user reference](docs/reference.md) for operation and compatibility details.

## Privacy and external services

Local inference uses files on your machine. Optional web search sends the search question to its configured service, model downloads contact Hugging Face, and enabled MCP tools may communicate with their configured servers. Review tool access and approvals before using a workspace with sensitive files.

The desktop Runtime listens on loopback with session authentication. The [Runtime reference](docs/subsystems/runtime.md) documents API boundaries and current limitations. Credentials and backup contents have different storage rules; consult the [user reference](docs/reference.md) and [storage reference](docs/subsystems/storage.md) before moving or sharing application data. Local execution does not make every optional workflow offline.

## Community and contribution

Report bugs, suggest improvements or share reproducible model compatibility findings through [GitHub Issues](https://github.com/h-yu-u/Ownloom/issues). Include your app version, Mac model, model source and reproduction steps; remove personal data from logs before sharing them.

For source development and pull requests, start with the [contributor guide](docs/contributors.md). It links to toolchain setup, desktop and browser development, checks and tests in the [development guide](docs/development.md). Design and review expectations live in the [architecture](docs/architecture.md), [code standards](docs/code-standards.md) and [subsystem references](docs/subsystems/README.md). AI coding agents start at [AGENTS.md](AGENTS.md).

## Compatibility and release status

Model support and release checks are tracked in the [verification matrix](docs/verification.md). Automated tests and packaged smoke checks cover specific paths; they do not establish compatibility with every model, native GUI/Gatekeeper behavior or independent clean-machine acceptance. Developer ID signing and notarization remain separate release work.

## Documentation

- [User reference](docs/reference.md): workspaces, configuration and local data.
- [Development](docs/development.md): environment, commands and generation workflows.
- [Architecture](docs/architecture.md) and [code standards](docs/code-standards.md): enduring design and review rules.
- [Subsystems](docs/subsystems/README.md): maintained implementation references.
- [Verification](docs/verification.md) and [release acceptance](docs/release-acceptance.md): evidence, limitations and repeatable release checks.
- [Releases](docs/release.md): tag-triggered builds, package smoke checks and formal publishing with Latest status.
- [Lessons](LESSONS.md): evidence-backed findings and how they become standards.

## License and acknowledgements

Ownloom's code and documentation are available under the [MIT License](LICENSE), copyright © 2026 h-yu-u. Dependencies and model weights retain their own licenses; this license does not grant rights to downloaded models or external services.

Ownloom builds on the MLX ecosystem, Tauri, Vue, Naive UI, Pi and the Tavily SDK. Its documentation maintenance approach draws on [Magpie](https://github.com/yetone/magpie): concise agent guidance, evidence-backed lessons, stable code standards and references owned by each subsystem. Project-specific implementation and verification claims are documented against Ownloom's source.
