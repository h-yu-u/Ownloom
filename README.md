<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.png" width="96" alt="Ownloom icon">
</p>

# Ownloom

**Your local AI workspace on Apple Silicon.**

Chat with local models, create images and speech, and work on code in one desktop application. Ownloom combines a Vue interface, a Tauri shell and isolated MLX inference workers, with a Pi-powered workspace for coding and tools.

**English** · [简体中文](README.zh-CN.md) · [Documentation](docs/README.md) · [Contributing](docs/contributors.md) · [License](LICENSE)

## Project status

Ownloom is a local AI workspace for **Apple Silicon macOS**. Download an installer from [Releases](https://github.com/h-yu-u/Ownloom/releases), or start from source below. Installers are ad-hoc signed and not Apple notarized; macOS may require manual approval in Privacy & Security. Compatibility depends on the model, adapter and available memory; an MLX label or a successful download does not guarantee support.

The repository contains automated checks and packaged-app acceptance tools. Developer ID signing, notarization, independent clean-machine testing and extended stability acceptance remain separately tracked verification work. See the [verification matrix](docs/verification.md) for the evidence and remaining limitations.

## What you can do

| Workspace       | Capabilities                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Chat            | Stream local responses, keep conversation history, stop or regenerate a response, and use compatible image or document attachments.    |
| Models          | Discover and download models from Hugging Face, import local directories, and manage loading and storage.                              |
| Image creation  | Generate images, edit with reference images and use masked editing with supported models; save and reuse works.                        |
| Speech creation | Use Qwen3-TTS preset voices or reference-based cloning, manage voice profiles, and export WAV audio.                                   |
| Coding          | Work in a local project through Pi, review tool activity and changes, approve protected operations, and inspect verification evidence. |
| Extensions      | Configure managed Skills, MCP connections and local tools for supported agent workflows.                                               |
| Tasks and data  | Follow tasks across workspaces, inspect diagnostics, and explicitly back up, restore or clean application data.                        |

Optional web search uses a configured Tavily-compatible service and preserves sources with the answer. Text-layer PDF, DOCX, TXT and Markdown are supported; scanned PDFs require OCR that is not currently provided. See the [user reference](docs/reference.md) for operation and compatibility details.

## Quick start

Install **Node.js 22 (22.19.0 or later)**, **pnpm 11.11.0**, **uv**, a **Python 3.12** runtime, **Rust** and the macOS command-line developer tools. The [development guide](docs/development.md) explains prerequisites and alternative development paths.

```bash
git clone https://github.com/h-yu-u/Ownloom.git
cd Ownloom
nvm use
UV_PYTHON=3.12 pnpm bootstrap
UV_NO_SYNC=1 pnpm dev
```

`nvm use` is for nvm users; otherwise select Node.js 22 with your version manager. `UV_PYTHON=3.12` selects the required Python version; `bootstrap` installs the locked dependencies and optional inference packages. `UV_NO_SYNC=1` keeps that prepared environment, including audio dependencies, when the desktop launches its development Runtime. After dependency changes, run `UV_PYTHON=3.12 pnpm bootstrap` again before starting.

Open **Models**, download or import a compatible local model, then select it in the relevant workspace. Weights are not included. Initial dependency installation and model downloads require network access. The normal application starts with an empty model library; FakeEngine is an isolated development and testing facility.

`pnpm dev web` starts only the frontend. A separately configured Runtime is required for browser development; follow the [development guide](docs/development.md).

## How it fits together

| Part                                  | Responsibility                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| Vue 3, TypeScript, Pinia and Naive UI | Workspaces, interaction and presentation; application ports isolate platform access. |
| Tauri 2 / Rust                        | Native dialogs, authenticated Runtime startup and process lifecycle.                 |
| Python / FastAPI Supervisor           | Product API, task scheduling, model management and application data.                 |
| Isolated inference Worker             | MLX text/vision, MFLUX images and MLX Audio speech adapters.                         |
| Node.js / Pi Host                     | Coding and agent execution, approvals, extensions and their owned persistence.       |

The [architecture](docs/architecture.md) defines the system invariants. [Subsystem references](docs/subsystems/README.md) describe the current runtime paths, contracts and failure behavior.

## Privacy and external services

Local inference uses files on your machine. Optional web search sends the search question to its configured service, model downloads contact Hugging Face, and enabled MCP tools may communicate with their configured servers. Review tool access and approvals before using a workspace with sensitive files.

The desktop Runtime listens on loopback with session authentication. The [Runtime reference](docs/subsystems/runtime.md) documents API boundaries and current limitations. Credentials and backup contents have different storage rules; consult the [user reference](docs/reference.md) and [storage reference](docs/subsystems/storage.md) before moving or sharing application data. Local execution does not make every optional workflow offline.

## Development and contribution

Start with the [development guide](docs/development.md), [code standards](docs/code-standards.md) and the relevant subsystem reference. The main checks are:

```bash
pnpm check
pnpm test
```

`pnpm check` includes documentation validation. Test success does not establish real-model compatibility or release readiness; those checks are documented separately.

Bug reports and focused contributions are welcome through [GitHub Issues](https://github.com/h-yu-u/MlxDesktop/issues) and pull requests. Include reproduction steps, the tested revision, verification results and any untested paths. Follow [contributor guidance](docs/contributors.md); agents start at [AGENTS.md](AGENTS.md).

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
