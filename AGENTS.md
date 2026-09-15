# Project instructions

- Build a native Ubuntu desktop application specifically for the official Codex CLI.
- Keep the same conversation synchronized between Desk and the real CLI using the shared local app-server. Preserve conversation IDs and history.
- CLI runtime settings take priority. Desk may override them only after an explicit change in its UI. Inherit sandbox, approval policy, model, reasoning, and collaboration settings on ordinary sends.
- Keep development and validation isolated from the user's running llama.cpp work: use this repository and dedicated temporary workspaces/conversations; never stop or alter that session or its processes.
- Provide English and Simplified Chinese for user-facing controls.
- Allow the first conversation to start in a default workspace without requiring a project picker.
- Creating or selecting a conversation prepares a background Ubuntu Terminal tab. Preserve keyboard focus and the current terminal tab; reuse the same process, and keep native terminals alive after Desk closes.
- The user requests that future completed updates be committed and pushed to this public GitHub repository. Publish updated Ubuntu release artifacts when shipping desktop application changes, and update the local installation when applicable.
- Run meaningful checks for the changed behavior before publishing. Use synthetic data for tests and public screenshots; do not commit local credentials or real conversation history.
