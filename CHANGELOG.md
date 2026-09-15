# Changelog

## 0.2.1

- Paste screenshots and copied images with Ctrl+V, preview/remove them before sending, and preserve ordinary text paste. Up to 8 images per message, 20 MiB each; pasted rasters are stored as private PNG attachments for shared CLI history.
- Inherit live CLI sandbox, approvals, model, reasoning, and collaboration settings on ordinary sends. Only an explicit Desk selection overrides them; Full access now matches CLI YOLO (`danger-full-access` + `never`). Restore saved legacy sandbox settings when resuming an unloaded conversation.
- Choose CLI defaults, Read only, Standard, or YOLO on the new-conversation screen. Mode changes preserve the draft and image attachments.
- Show a dismissible top notification when a turn completes or fails. Background completions use Ubuntu desktop notifications; clicking one returns to its conversation. Interrupted turns and duplicate completion events do not produce completion notices.

## 0.2.0

- Shared official app-server connection for same-thread CLI ↔ Desk synchronization; preserve history and drafts when a standalone writer needs to reconnect.
- First message starts in a default workspace. Empty sessions are materialized for CLI resume, and text drafts survive restarts.
- Detailed model, reasoning, and permission popovers with keyboard navigation.
- Complete searchable CLI 0.154.0 slash-command inventory, with embedded real CLI support for terminal commands and custom commands.
- Goal controls and a top-right status indicator synchronized through official goal notifications; real Plan mode and session status.
- Original gradient SVG cyberpunk sakura icon, also used for Ubuntu desktop packages.

## 0.1.0

- Initial native Ubuntu desktop application: projects, persisted Codex history, streaming conversations, approvals, models, image attachments, file/Git inspection, and Chinese / English light / dark interfaces.
