# Ownloom Engineering Rules

This repository follows the [engineering rules](./docs/engineering.md) and the [architecture](./docs/architecture.md).

## Local development

- Use Node.js 22 and pnpm 11 for the desktop frontend.
- Use Python 3.12 managed by uv for the Runtime. MLX engine dependencies are optional in development and loaded only by the MLX adapter.
- Keep the first release Apple Silicon/macOS only. The FakeEngine supports API and UI work on other hosts.
- Run `pnpm check` and `pnpm test` before completing changes when the corresponding toolchains are available.
- Do not commit generated model files, private diagnostics, signing identities, tokens, or model downloads.

## Current implementation boundary

The runtime API and desktop UI support the FakeEngine path. Real MLX text, VLM, MFLUX, hardened sidecar packaging, signing/notarization, and clean-machine verification must remain explicitly reported as unverified until completed on a network-enabled Apple Silicon build host.
