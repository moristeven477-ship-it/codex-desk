# Release validation — 0.2.4

Validated on Ubuntu 24.04.4 x86-64 (X11), Node.js 22.23.2 and Electron 44.3.0 on 2026-09-15.

| Check                                       | Result / coverage                                                                                                                                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting, TypeScript and production build | Passed                                                                                                                                                                                                                                                    |
| Unit / protocol integration                 | 17 tests passed, including fractional preference persistence and invalid bounds/NaN rejection                                                                                                                                                             |
| Browser workflows                           | 18 tests passed; pointer drag previews a fractional size without preference writes, release saves once, keyboard edits survive reload, closing Settings saves pending changes, reset and English layout work, reduced-motion disables the font transition |
| Packaged AppImage                           | Passed on an isolated display: 17.35 px preview, persistence after closing/reloading and reset; existing native clipboard, images, steering, YOLO, terminal, goals and notification workflows                                                             |
| Ubuntu artifacts                            | `.deb` metadata inspected, AppImage executed, SHA-256 checksums produced                                                                                                                                                                                  |

## Reproduce

```bash
npm ci
npm run format:check
npm run typecheck
npm test
npm run test:e2e
npm run package:linux
APPIMAGE_EXTRACT_AND_RUN=1 DESK_TEST_CLIPBOARD=1 \
  DESK_EXECUTABLE="$PWD/release/codex-desk-0.2.4-x86_64.AppImage" \
  npm run test:native
```

Native smoke checks require `gnome-terminal python3-gi gir1.2-gtk-3.0 openbox xvfb dbus-x11 x11-utils xauth libxtst6`. They use a private Xvfb display, D-Bus session and temporary app data. Only test-owned CLI processes are cleaned up; the user's shared server and workspaces are untouched.

## Behavior and limits

The slider uses 0.01 px precision over the existing 12–22 px range. The renderer previews at most once per animation frame, with an 80 ms font transition. Pointer release, blur and closing Settings commit pending changes; keyboard controls and assistive input also save automatically. Reduced-motion preference disables the transition. Native Ubuntu Terminal retains its own font profile.

This update changes local appearance preferences only. CLI synchronization, permission precedence and steering are covered by the unchanged protocol tests and packaged smoke workflows. The installed-CLI steering validation from 0.2.3 is recorded in the [previous release validation](VALIDATION-0.2.3.md).
