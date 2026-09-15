# Project instructions

- Build a native Ubuntu desktop application specifically for the official Codex CLI.
- Keep the same conversation synchronized between Desk and the real CLI using the shared local app-server. Preserve conversation IDs and history.
- Provide English and Simplified Chinese for user-facing controls.
- Allow the first conversation to start in a default workspace without requiring a project picker.
- The user requests that future completed updates be committed and pushed to this public GitHub repository. Publish updated Ubuntu release artifacts when shipping desktop application changes, and update the local installation when applicable.
- Run meaningful checks for the changed behavior before publishing. Use synthetic data for tests and public screenshots; do not commit local credentials or real conversation history.
