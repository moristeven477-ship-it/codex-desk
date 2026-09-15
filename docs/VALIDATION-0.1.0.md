# Release validation — 0.1.0

Validated on Ubuntu 24.04.4 x86-64, Node.js 22.23.2, and Codex CLI 0.154.0, on 2026-09-15.

| Check                           | Result / coverage                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript and production build | Passed; renderer and bundled main/preload                                                                                             |
| Unit / subprocess integration   | 9 passed: streaming, process framing/restarts/crashes, approvals, settings persistence, file boundaries, Git paths and subdirectories |
| Browser workflows               | 5 passed: languages/themes/files, history/send/rename/archive, approve/stop, reconnect, small-window inspector                        |
| Real installed Codex            | Connected, fetched models/account state, listed and read existing history                                                             |
| Real isolated model turn        | Received the requested `CODEX_DESK_OK` marker in a temporary read-only project; archived the test conversation                        |
| Native packaged desktop         | Launched and completed a synthetic conversation through the real Electron IPC/preload and Codex subprocess boundary                   |
| AppImage                        | Launched with `APPIMAGE_EXTRACT_AND_RUN=1`; renderer sandbox enabled, no `--no-sandbox` switch                                        |
| Debian package                  | Built and inspected metadata, dependencies, desktop entry, and installer scripts                                                      |

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
APPIMAGE_EXTRACT_AND_RUN=1 DESK_EXECUTABLE="$PWD/release/codex-desk-0.1.0-x86_64.AppImage" npm run test:native
```

Browser and native tests use a synthetic CLI and temporary app data. The native check requires a display; use `xvfb-run -a` on a headless machine. See the README for the optional live CLI checks, which are not run in CI.

## Limits

The `.deb` was not installed as root during this validation. Other Ubuntu versions, Wayland, architectures, CLI versions, and provider configurations have not been exhaustively tested. Passing fixture tests does not establish compatibility with every MCP server or protocol extension. This first release has not received an independent security audit.

The screenshots in this repository contain synthetic project and conversation data.
