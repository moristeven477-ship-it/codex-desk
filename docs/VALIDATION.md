# Validation — 0.4.1

The startup-mode fix was reproduced against the running Codex CLI 0.154.0: selecting an already active YOLO or read-only mode returned a successful acknowledgement, emitted no settings notification, and left Desk waiting until its ten-second timeout. Desk now confirms unchanged selections by reading the loaded thread's actual settings without overrides.

## Checks

- 35 unit/protocol tests passed, including repeated startup modes and Fast selections, delayed settings application, changed sandbox roots/network access under the same mode name, rejected settings and active-turn protection.
- 25 desktop browser workflows and 3 phone browser workflows passed. The phone regression first enables YOLO in the CLI, then selects YOLO in the mobile UI, sends one message and verifies one completed turn with unchanged full-access permissions.
- Unmodified CLI **0.154.0 and 0.158.0** passed the live smoke test in isolated homes/workspaces with a loopback Responses provider. All startup modes and Fast on/off were selected repeatedly; turns, steering and shared history completed. Ordinary Desk sends inherit the CLI settings.
- The packaged Ubuntu AppImage passed the native IPC, PTY, background terminal, clipboard, image, permissions, font, steering, compaction, completion notice and phone gateway checks.
- Android endpoint unit tests, release lint and the release build passed. Native Android code is unchanged; the APK version is 0.4.1. The existing 0.4.0 APK receives the fix when its computer updates.

The live test checks provider request tiers against the real CLI's behavior: 0.154.0 sent `priority` to the synthetic custom provider, while 0.158.0 omitted that field. Both reported the selected runtime Fast setting; Desk preserves each CLI's behavior. The app does not implement model billing or priority routing itself.

CI now runs both pinned real CLI versions against the local provider in addition to the desktop, phone and actual Android emulator suites. Android transport validation and its physical-device limits are documented in [0.4.0 validation](VALIDATION-0.4.0.md).

## Reproduce

```bash
npm ci
npm run format:check
npm run typecheck
npm test
npm run test:e2e
npm run test:remote
DESK_LIVE_BINARY=/absolute/path/to/codex npm run test:steer
npm run package:linux
APPIMAGE_EXTRACT_AND_RUN=1 DESK_TEST_CLIPBOARD=1 DESK_TEST_NO_SANDBOX=1 \
  DESK_EXECUTABLE="$PWD/release/codex-desk-0.4.1-x86_64.AppImage" npm run test:native
```

The live smoke test starts and closes its own server and uses a local synthetic model, without account credentials or changes to other CLI sessions. The production shared server is never restarted during a Desk update. For Android build/emulator commands, see [the Android guide](ANDROID.md#build-android-from-source).
