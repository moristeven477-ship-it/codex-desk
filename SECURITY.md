# Security

Codex Desk can start a coding agent that operates on your files. Its trust boundary is the local desktop application and the Codex installation you select.

- Local Unix domain socket transport, with no TCP listening port or cloud relay.
- Context-isolated, sandboxed Electron renderer without Node integration.
- IPC validates the main frame and input shape; application operations are allowlisted.
- The embedded terminal starts only the selected Codex executable in a real PTY, with argument arrays and the same shared-server conversation. Interactive CLI input is available through validated terminal operations. The bridge uses Ubuntu's Python 3 standard library, never a renderer-provided shell command.
- External links are limited to HTTP/HTTPS. Raw HTML is not rendered from agent Markdown.
- File previews use canonical project boundaries and bounded reads. Symlink escapes are rejected.
- Git runs through `execFile` with argument arrays; external diff/textconv helpers and fsmonitor are disabled.
- Model execution and permission enforcement belong to Codex. Conversations inherit CLI settings unless the user explicitly selects a Desk override; the YOLO preset disables the Codex sandbox and approval prompts. Electron renderer isolation remains enabled.
- Clipboard imports accept bounded raster bytes, validate/decode them in the main process, and write private PNG files with random filenames. The renderer cannot authorize arbitrary image paths.
- Legacy permission recovery reads only a bounded tail of the Codex-provided rollout path under its canonical sessions directory; it never rewrites CLI history.
- Credentials stay under Codex's control. No app telemetry is added.

Only select a Codex executable and projects you trust. Project hooks, MCP servers, model providers, and Codex tools remain part of the Codex execution environment.

Please report vulnerabilities through the repository's GitHub security reporting feature if available. Do not post credentials or a live exploit against someone else's environment in a public issue. For non-sensitive defects, use the issue tracker.

Version 0.2.x is the currently supported release line. This project has not received an independent security audit.
