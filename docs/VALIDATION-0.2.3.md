# Release validation — 0.2.3

Validated on Ubuntu 24.04.4 x86-64 (X11), GNOME Terminal 3.52, Node.js 22.23.2, Electron 44.3.0, and Codex CLI 0.154.0 on 2026-09-15.

| Check                                      | Result / coverage                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting / TypeScript / production build | Passed; renderer, main/preload and native terminal helpers packaged                                                                                                                                                                                                                          |
| Unit / protocol integration                | 17 tests passed: active-turn steering between two clients, expected-turn rejection, image authorization, CLI settings inheritance, existing synchronization/permissions/PTY/notification/workspace behavior                                                                                  |
| Browser workflows                          | 18 tests passed: live font sizing, rapid changes, persistence/reset, English at 880 px width; exact user/assistant text copying and failure feedback; repeated text/image steering, later typing preserved, rejected steer retains text/images; existing workflows                           |
| Packaged AppImage                          | Passed in isolated Xvfb + D-Bus + Openbox: font preview/reload/reset, native clipboard contents after both Copy buttons, running-turn steering through actual Electron IPC; existing paste, YOLO, goals, embedded CLI, notifications and terminal reuse/survival checks                      |
| Installed Codex CLI                        | Separate home, Unix app-server, workspace and loopback Responses fixture; a CLI-started turn accepted one Desk steer and one CLI steer, reached the provider with both additions, and completed as exactly one turn with three user messages; YOLO preserved; stale/completed turns rejected |
| Ubuntu artifacts                           | `.deb` version/architecture/dependencies inspected; AppImage executed; both artifacts have SHA-256 checksums                                                                                                                                                                                 |
| Isolation                                  | Renderer sandbox/context isolation enabled; tests use no `--no-sandbox`, do not access real account credentials and do not alter running user work                                                                                                                                           |

## Reproduce

```bash
sudo apt install build-essential gnome-terminal python3-gi gir1.2-gtk-3.0 openbox xvfb dbus-x11 x11-utils xauth libxtst6
npm ci
npm run format:check
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run test:steer
npm run package:linux
npm run test:terminal
APPIMAGE_EXTRACT_AND_RUN=1 DESK_TEST_CLIPBOARD=1 \
  DESK_EXECUTABLE="$PWD/release/codex-desk-0.2.3-x86_64.AppImage" \
  npm run test:native
```

`test:steer` uses the installed `codex` (or an absolute `DESK_LIVE_BINARY` path). It runs the unmodified CLI against a synthetic HTTP Responses provider bound to loopback. This validates the real CLI's steering protocol, turn lifecycle and model-request input, not a remote model's answer quality or response latency. It needs no API key and makes no external model request. Its app-server and Codex home are temporary and independent of the user's shared server.

Native tests use private displays and D-Bus sessions with no desktop-service activation directories. Notifications are captured inside the test Electron process, and clipboard contents are confined to the test display. Only test-owned CLI processes are cleaned up. Public screenshots use synthetic data.

## Limits

Font size scales Desk text and its embedded CLI. Native Ubuntu Terminal uses the user's own profile. Text-message Copy actions copy original text/Markdown; image attachments are not copied as image clipboard content.

Steering targets one active turn and preserves its CLI settings. An accepted steer is processed by Codex during that task; no new turn is created as a fallback. If the server rejects it, the draft/attachments remain available. Slash commands retain their own command semantics.

Background window behavior is validated on Ubuntu 24.04 X11; Wayland and other desktops are not separately validated. Native integration needs GNOME Terminal 3.x and Python GObject bindings, installed separately for AppImage. The `.deb` was inspected rather than installed as root. A standalone CLI owns its writer until it exits; Desk waits and preserves history. Unsent image selections are not restored after an application restart.

[Previous release validation](VALIDATION-0.2.2.md).
