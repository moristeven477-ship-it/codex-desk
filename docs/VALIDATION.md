# Release validation — 0.2.0

Validated on Ubuntu 24.04.4 x86-64 (X11), Node.js 22.23.2, Electron 44.3.0, Python 3.12, and Codex CLI 0.154.0 on 2026-09-15.

| Check                           | Result / coverage                                                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript and production build | Passed; renderer, main/preload bundle, and packaged Python PTY bridge                                                                                                                                     |
| Unit / protocol integration     | 12 passed: existing file/Git/settings checks plus shared Unix WebSocket clients, bidirectional turns, goals, approval resolution, standalone writer recovery, and real PTY input / resize / exit          |
| Browser workflows               | 10 passed: existing workflows plus default workspace, persistent drafts, model popup keyboard controls, all 60 commands, Plan mode, goal notifications, legacy writer recovery, and embedded CLI commands |
| Command inventory               | Exact match with all 60 definitions and aliases in the pinned upstream CLI 0.154.0 source; gated entries remain conditional                                                                               |
| Real CLI ↔ Desk messages        | Passed both directions through the real TUI and shared app-server in one isolated read-only conversation                                                                                                  |
| Real CLI ↔ Desk goals           | Desk-created paused goal displayed in the real TUI; CLI clearing it reached Desk through the official notification                                                                                        |
| Empty conversation handoff      | Real TUI successfully resumed a newly materialized empty Desk thread before its first model turn                                                                                                          |
| Native packaged desktop         | Conversation, goal panel, and embedded PTY command passed through actual Electron IPC/preload                                                                                                             |
| AppImage                        | Same native checks passed with extract-and-run; renderer sandbox enabled and no --no-sandbox switch                                                                                                       |
| Debian package                  | Built; package version / architecture / dependencies checked, including Python 3                                                                                                                          |

## Reproduce

```bash
npm ci
npm run format:check
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run package:linux
npm run test:native
APPIMAGE_EXTRACT_AND_RUN=1 DESK_EXECUTABLE="$PWD/release/codex-desk-0.2.0-x86_64.AppImage" npm run test:native
```

Browser and native tests use synthetic data and an isolated shared Unix listener. A native check needs a display; use `xvfb-run -a` on a headless machine.

The opt-in live round trip uses the installed login and a small amount of quota:

```bash
npx tsx scripts/live-sync.ts --turns
```

It checks two-way messages and goals, then archives only its own test conversation. Live checks do not run in CI. Screenshots in the repository contain only synthetic projects and conversation data.

## Limits

The `.deb` was inspected rather than installed as root. Other Ubuntu versions, Wayland, architectures, CLI versions, and provider configurations have not been exhaustively tested. The command inventory is complete for the pinned version; platform / feature gates remain upstream decisions, and destructive commands were not individually executed during validation. Fixture tests do not establish compatibility with every MCP server or protocol extension. This project has not received an independent security audit.

[Initial release validation](VALIDATION-0.1.0.md).
