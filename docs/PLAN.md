# Codex Desk v0.1

## Accepted scope

- Built from scratch, dedicated to managing local Codex CLI.
- Ubuntu desktop first: Electron, React, TypeScript, `.deb` and AppImage.
- English and Simplified Chinese interfaces, documentation, and dark/light themes.
- Qoder-inspired project/files workspace and ChatGPT-inspired conversation/composer; original implementation and branding.
- Projects, CLI history, thread creation/resume/rename/archive/fork, streaming replies and tool activity, stop, approvals, model and reasoning selection, image attachments, file and Git diff inspection.
- Reuse the installed CLI and its existing authentication. No intermediary AI service.
- Publish tested source and Ubuntu artifacts to a public GitHub repository under MIT.

## Architecture

The sandboxed renderer calls an explicit preload API. The Electron main process validates IPC inputs, owns the Codex app-server subprocess, and exposes only application operations. There is no network listener. Conversations stay in Codex's own storage; app preferences and project bookmarks stay in Electron's user-data directory.

## Release gates

- Type checking and production build.
- Protocol lifecycle/streaming/approval failure tests with a fake subprocess.
- Filesystem boundary and Git tests using disposable workspaces.
- Browser interaction tests for the main workflows with deterministic synthetic fixtures.
- Installed Codex read-only integration smoke check; opt-in isolated real turn.
- Ubuntu package build and native Electron launch check.
- Documentation, privacy/security notes, license, CI, and release artifacts.

## Scope boundaries

This version is a Codex manager rather than a full source editor. Git operations in the inspector are read-only. It does not claim to attach to the live output of a separate CLI process; it can read and resume persisted CLI conversations. Remote hosting, other AI providers, automatic updates, and scheduled jobs are future work.

## Delivered in 0.1.0

The accepted scope is implemented. See [validation](VALIDATION.md) for test evidence and limits, [Releases](https://github.com/moristeven477-ship-it/codex-desk/releases) for Ubuntu packages, and the bilingual README files for usage.
