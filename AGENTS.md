# Notes for coding agents

## Before changing Ownloom

1. Read the [system architecture](docs/architecture.md) and [code standards](docs/code-standards.md).
2. Find the owning [subsystem reference](docs/subsystems/README.md), then verify its linked source and callers.
3. Read [LESSONS.md](LESSONS.md) for evidence-backed review lessons.
4. Use the [development guide](docs/development.md) for the actual toolchain and commands.

## Scope and safety

- Keep changes focused on the requested outcome. Preserve user edits and use an isolated branch or worktree when work overlaps.
- Use Ownloom in user-facing text. Preserve technical identifiers, persisted formats and paths unless an explicit compatibility change is part of the task.
- Keep application logic out of Vue components, native commands and transport handlers. Follow the documented ownership and dependency boundaries.
- Never commit credentials, model weights, private diagnostics, generated media, signing identities or local acceptance databases.
- Tests must use isolated data and stop every process or observer they start. Do not use a person's installed application, live workspace, credentials or model downloads as test fixtures.
- Do not automatically commit, push, merge or rebase. Follow the maintainer's authorization; repository access alone is not authorization to publish a release.

## Documentation and review

When responsibilities, interfaces, states, failure behavior or compatibility change, update the owning reference in the same PR. Keep a fact in one reference and link to it elsewhere. Proposals belong in an issue or PR; current documentation describes implemented behavior.

Keep [README.md](README.md) and [README.zh-CN.md](README.zh-CN.md) aligned on capabilities, setup, limitations and licensing. Follow the [contribution and review workflow](docs/contributors.md) when preparing a change.

## Verification

Run `pnpm check` and `pnpm test` when the corresponding toolchains are available. Documentation changes must pass `pnpm check:docs`. Use the development guide to select additional contract, Rust, build or native checks for the changed path.

Report the commands, environment, tested revision, outcomes and checks not run. Distinguish source checks, FakeEngine tests, real-model tests, packaged-app tests and distribution acceptance. The current evidence boundary belongs in [verification](docs/verification.md), not in this file. Never describe an unavailable or skipped check as passed.
