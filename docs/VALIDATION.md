# Release validation — 0.2.1

Validated on Ubuntu 24.04.4 x86-64 (X11), Node.js 22.23.2, Electron 44.3.0, and Codex CLI 0.154.0 on 2026-09-15.

| Check                           | Result / coverage                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript and production build | Passed for renderer, main/preload, and Python PTY bridge                                                                                                                                                                                         |
| Unit / protocol integration     | 15 passed, including CLI-first settings, explicit YOLO overrides, legacy permission recovery, completion deduplication, existing Unix sync / PTY / workspace tests                                                                               |
| Browser workflows               | 13 passed: image paste/send/removal/limits, asynchronous thread switching, CLI settings inheritance, explicit permission selection, startup YOLO, and completion navigation / timeout, plus existing workflows                                   |
| Native Electron / AppImage      | Real Ctrl+V image and text paste on an isolated Xvfb display, private PNG persistence, authorized localImage send, failed batch cleanup, IPC limits, YOLO startup, foreground completion banner, native notification creation and click callback |
| Renderer isolation              | Sandbox and context isolation enabled; no `--no-sandbox` switch                                                                                                                                                                                  |
| Real installed Codex            | Reproduced default-sandbox replacement on resume; verified Desk restores `dangerFullAccess` and `never` from a saved test turn in an isolated Codex home/workspace                                                                               |
| Ubuntu packages                 | AppImage and .deb built; metadata and SHA-256 sums verified                                                                                                                                                                                      |

## Reproduce

```bash
npm ci
npm run format:check
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run package:linux
DESK_TEST_CLIPBOARD=1 xvfb-run -a npm run test:native
APPIMAGE_EXTRACT_AND_RUN=1 DESK_TEST_CLIPBOARD=1 \
  DESK_EXECUTABLE="$PWD/release/codex-desk-0.2.1-x86_64.AppImage" \
  xvfb-run -a npm run test:native
```

The real clipboard check must run on an isolated display because it writes that display's clipboard. Without `DESK_TEST_CLIPBOARD=1`, the native check uses a synthetic paste event. Both paths use the actual Electron preload, validated image import, and Codex input pipeline. Native notifications are captured inside the test process to verify construction and click handling without sending test notifications to the user's desktop; the in-app banner is visually verified.

All automated tests use synthetic projects and isolated app data. The real Codex permission check used a temporary Codex home and a test conversation, without accessing the user's ongoing llama.cpp work. No real conversation screenshots or credentials are published.

## Limits

The `.deb` was inspected rather than installed as root. Wayland and other Ubuntu versions have not been exhaustively tested. A standalone CLI's settings cannot be observed live through a different app-server; its last persisted turn context is used when available. Recovery reads at most the last 16 MiB of a canonical legacy rollout; unknown or unavailable formats do not produce an invented permission state. OS notification presentation depends on Ubuntu notification settings. Pasted image files are retained for history references; unsent image selections do not survive an app restart.

[Previous release validation](VALIDATION-0.2.0.md).
