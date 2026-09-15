# Security

Codex Desk can start a coding agent that operates on your files. Its trust boundary is the local desktop application and the Codex installation you select.

- No local network listener or cloud relay.
- Context-isolated, sandboxed Electron renderer without Node integration.
- IPC validates the main frame and input shape; application operations are allowlisted.
- External links are limited to HTTP/HTTPS. Raw HTML is not rendered from agent Markdown.
- File previews use canonical project boundaries and bounded reads. Symlink escapes are rejected.
- Git runs through `execFile` with argument arrays; external diff/textconv helpers and fsmonitor are disabled.
- Model execution and permission enforcement belong to Codex. The default is workspace write with approvals routed to the user.
- Credentials stay under Codex's control. No app telemetry is added.

Only select a Codex executable and projects you trust. Project hooks, MCP servers, model providers, and Codex tools remain part of the Codex execution environment.

Please report vulnerabilities through the repository's GitHub security reporting feature if available. Do not post credentials or a live exploit against someone else's environment in a public issue. For non-sensitive defects, use the issue tracker.

Version 0.1.x is the currently supported release line. This project has not received an independent security audit.
