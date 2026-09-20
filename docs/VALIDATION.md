# Release validation — 0.2.6

Validated on Ubuntu 24.04.4 x86-64 (X11), Node.js 22.23.2 and Electron 44.3.0 on 2026-09-19.

## Checks

| Check                                       | Result / coverage                                                                                                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting, TypeScript and production build | Passed                                                                                                                                                                                                          |
| Unit / protocol integration                 | 21 tests passed; summary merging, CLI settings inheritance, confirmed Fast changes, failure handling and unchanged permissions                                                                                  |
| Browser workflows                           | 22 tests passed; Fast toggle, slash commands, CLI updates, pending/error states, unsupported models, messages from both clients, navigation and reload                                                          |
| Unmodified Codex CLI                        | 0.154.0 and 0.155.1 passed isolated loopback Responses checks: Fast defaults, on/off synchronization, actual request tiers, summary completion retaining three user messages and unchanged YOLO                 |
| Packaged AppImage                           | Passed: Fast through native IPC, user/assistant copy after summary completion, clipboard/images, steering, compaction, goals, font preferences, completion notifications and background terminal reuse/survival |
| Ubuntu artifacts                            | AppImage executed; .deb version/architecture checked; .deb and AppImage source bundles match; SHA-256 checksums generated                                                                                       |

## Reproduce

```bash
npm ci
npm run format:check
npm run typecheck
npm test
npm run test:e2e
npm run test:steer
npm run package:linux
APPIMAGE_EXTRACT_AND_RUN=1 DESK_TEST_CLIPBOARD=1 DESK_TEST_NO_SANDBOX=1 \
  DESK_EXECUTABLE="$PWD/release/codex-desk-0.2.6-x86_64.AppImage" \
  npm run test:native
```

`test:steer` uses the installed CLI with a temporary workspace, CODEX_HOME and loopback Responses provider. `DESK_LIVE_BINARY` selects an executable. It uses no account, external model request or user conversation. Both 0.154.0 and 0.155.1 were exercised.

## Protocol behavior and limits

Current CLI versions emit a final `turn/completed` with `itemsView: summary` and only the last assistant answer. Desk now merges partial summaries by item ID, preserving streamed user messages, steering input and tools. Explicitly full snapshots remain authoritative. Persisted history is read with `itemsView: full`; no conversation data is rewritten or forked.

Fast uses the model catalog's service-tier ID (`priority` on the tested CLI), the live thread settings and `thread/settings/update`. Acknowledgement alone does not unlock the composer: Desk waits for the settings notification. Current CLI versions normalize an explicit null clear to `default`; Desk also accepts null from older servers. Ordinary messages and steers omit service-tier overrides. Explicit changes affect this conversation and preserve CLI global defaults, model and permissions.

The isolated provider validates request routing and protocol behavior. It does not measure production latency, account entitlement or billing. The interface describes increased usage without promising a fixed speedup.

The native smoke run uses a private Xvfb display and D-Bus session, with the Chromium OS sandbox disabled for the isolated test environment. Context isolation, disabled Node integration and the renderer sandbox preference are checked; OS sandbox enforcement is not validated. Prerequisites are in [the 0.2.4 validation](VALIDATION-0.2.4.md). See [the 0.2.5 validation](VALIDATION-0.2.5.md) for the preceding compaction changes.
