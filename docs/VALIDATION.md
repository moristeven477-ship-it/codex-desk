# Release validation — 0.2.5

Validated on Ubuntu 24.04.4 x86-64 (X11), Node.js 22.23.2 and Electron 44.3.0 on 2026-09-19.

| Check                                       | Result / coverage                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting, TypeScript and production build | Passed                                                                                                                                                                       |
| Unit / protocol integration                 | 19 tests passed; compaction events, terminal errors, preserved settings and rejection of work already running before Desk connects                                           |
| Browser workflows                           | 20 tests passed; progress, failed compaction, explicit retry, service `content_filter` with no item, reload, both languages and new-conversation action                      |
| Installed CLI                               | 0.154.0 and 0.155.1 passed an isolated loopback Responses test: compaction failure and success reach both clients, history remains readable and YOLO settings stay unchanged |
| Packaged AppImage                           | Passed: packaged Electron IPC compaction, shared terminal, native clipboard/images, steering, YOLO, font preferences, goals and completion notifications                     |
| Ubuntu artifacts                            | AppImage executed; .deb metadata inspected; .deb and AppImage source bundle hashes match; SHA-256 checksums generated                                                        |

## Reproduce

```bash
npm ci
npm run format:check
npm run typecheck
npm test
npm run test:e2e
npm run test:compact
npm run package:linux
APPIMAGE_EXTRACT_AND_RUN=1 DESK_TEST_CLIPBOARD=1 DESK_TEST_NO_SANDBOX=1 \
  DESK_EXECUTABLE="$PWD/release/codex-desk-0.2.5-x86_64.AppImage" \
  npm run test:native
```

`test:compact` uses the installed CLI, a temporary workspace and CODEX_HOME, and a loopback synthetic provider. `DESK_LIVE_BINARY` selects a specific executable. No account, external model call or user conversation is used. The native smoke run disabled the Chromium OS sandbox for the isolated test environment; context isolation, disabled Node integration and the renderer sandbox preference were checked. It does not validate OS sandbox enforcement. Native checks use a private Xvfb display and D-Bus session; see the [previous release validation](VALIDATION-0.2.4.md) for prerequisites.

## Behavior and limits

`thread/compact/start` acknowledges submission, while turn/item events report its outcome. The official `contextCompaction` item has no status field; Desk derives status from lifecycle events and preserves terminal failures. Pre-sampling errors with no items are also shown after reopening a conversation.

Remote `content_filter` means the service rejected the compaction response. This release explains that error and keeps its original details. It does not claim to repair or bypass the service, silently change a model or permissions, delete history, or automatically retry a filtered response. Other failures offer an explicit retry; a new-conversation action leaves the original thread available.

The real CLI check covers protocol behavior against a synthetic provider. It cannot establish that an external service will accept a particular conversation. Initial browser validation encountered a transient Chrome screenshot-capture error; the isolated rerun and complete 20-test rerun passed.
