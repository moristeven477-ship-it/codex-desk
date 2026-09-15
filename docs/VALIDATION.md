# Release validation — 0.2.2

Validated on Ubuntu 24.04.4 x86-64 (X11), GNOME Terminal 3.52, Node.js 22.23.2, Electron 44.3.0, and Codex CLI 0.154.0 on 2026-09-15.

| Check                         | Result / coverage                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript / production build | Renderer, main/preload, Python helpers and the native GTK presentation helper                                                                                                                                                       |
| Unit / protocol integration   | 16 tests: shared CLI settings/history, deferred startup-mode confirmation, PTYs, approvals, notifications and workspace boundaries                                                                                                  |
| Browser workflows             | 15 tests: terminals requested before first message, mode changes inherited from CLI, slow creation preserves text/images/focus and cannot replace a newer selection, plus existing workflows                                        |
| Native terminal               | Separate Xvfb display, D-Bus session and Openbox window manager; first window is iconified without focus, later tabs preserve the selected tab, process/screen reuse, manual restoration and real PTY typing, closed CLI recreation |
| Packaged Electron / AppImage  | Real GNOME Terminal via validated preload IPC, same PID on repeated selection, CLI survives Desk closure; real Ctrl+V image/text, private attachments, YOLO, goals, embedded CLI and completion notifications                       |
| Renderer isolation            | Sandbox and context isolation enabled; native tests use no `--no-sandbox` switch                                                                                                                                                    |
| Real installed Codex          | Separate Codex home, Unix server and workspace: native terminal preserves YOLO, explicit Read only applies through a confirmed settings notification, repeated preparation reuses the CLI; zero model turns                         |
| Ubuntu artifacts              | `.deb` and AppImage metadata and SHA-256 checks; native helper included outside ASAR, GNOME Terminal / Python GObject runtime dependencies declared                                                                                 |

## Reproduce

```bash
sudo apt install build-essential gnome-terminal python3-gi gir1.2-gtk-3.0 openbox xvfb dbus-x11
npm ci
npm run format:check
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run package:linux
npm run test:terminal
DESK_TEST_CLIPBOARD=1 npm run test:native
APPIMAGE_EXTRACT_AND_RUN=1 DESK_TEST_CLIPBOARD=1 \
  DESK_EXECUTABLE="$PWD/release/codex-desk-0.2.2-x86_64.AppImage" \
  npm run test:native
```

Terminal and native smoke runners create private displays and D-Bus sessions with no desktop-service activation directories. They use temporary app data, workspaces, and synthetic CLI processes. Notifications are captured inside the test Electron process. Only test-owned CLI processes are cleaned up. Public screenshots use synthetic data.

The real Codex check found that `thread/settings/update` acknowledges queueing before its settings notification arrives. Desk now waits for the matching applied policy before allowing a first message or goal to continue. It does not infer success from the empty RPC acknowledgment or overwrite a later CLI change. A regression fixture deliberately delays applying settings.

## Limits

Background window behavior is validated on Ubuntu 24.04 X11; Wayland and other desktops are not separately validated. The native integration requires GNOME Terminal 3.x and Python GObject bindings. AppImage users install these system components separately. The `.deb` was inspected rather than installed as root.

A standalone CLI still owns its writer until it exits; Desk waits and preserves its history. Terminal tabs remain open until closed in Ubuntu Terminal. The embedded slash-command modal continues to own a separate PTY client whose lifetime ends with that modal. OS notifications depend on desktop settings; unsent image selections are not restored after restarting Desk.

[Previous release validation](VALIDATION-0.2.1.md).
