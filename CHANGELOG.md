# Changelog

## 0.2.5

- Show context compaction progress, completion, failure and interruption from the official CLI events. A successful start acknowledgement is not treated as a completed compaction.
- Explain remote `content_filter` compaction failures in English and Simplified Chinese, including failures before an item is emitted. Keep the original error available after reload and preserve the conversation. Offer manual retry for other failures and a new-conversation action.
- Check live thread status before manual compaction, including CLI tasks already running when Desk connects. Keep standalone-writer commands in the synchronization flow and scope asynchronous error banners to the selected thread.
- Validate compaction failure/success with the unmodified Codex CLI 0.154.0 and 0.155.1 against a private synthetic provider; confirm shared history and unchanged YOLO settings. Remote service content filters are reported, not bypassed or claimed fixed.

## 0.2.4

- Make font sizing continuous with 0.01 px pointer precision and a short visual transition. Respect reduced-motion preferences.
- Preview locally once per animation frame instead of rerendering the conversation and saving every drag step. Save when the gesture ends, focus leaves, or Settings closes.
- Keep keyboard adjustment available: 0.1 px with arrows, 1 px with Shift + Arrow or Page Up/Down; Home/End reach the limits. Persist fractional sizes across restarts.

## 0.2.3

- Add a live font-size slider under Settings → General (12–22 px), with a preview, reset and automatic persistence. Scale conversation text, composer, interface and embedded CLI text while keeping native Ubuntu Terminal preferences intact.
- Add visible Copy actions to user messages as well as Codex replies/plans. Preserve exact plain text/Markdown and use validated native clipboard IPC with success and failure feedback.
- Implement steering through the official `turn/steer` API. While a task runs, press Enter or click Steer to add text/images to the same turn; Stop remains a separate action. Inherit the CLI's active settings, validate the expected turn ID and preserve drafts/attachments if a steer is rejected.
- Validate the installed Codex CLI with an isolated loopback Responses provider: a CLI-started turn accepts Desk and CLI steering, reaches the provider with both additions, completes as one turn and retains YOLO settings.

## 0.2.2

- Automatically prepare a real Ubuntu Terminal tab when creating or selecting a conversation. The first window starts minimized; later tabs stay in the background and leave the selected tab and keyboard focus alone.
- Reuse the same terminal and CLI process for a conversation across selections and Desk restarts. Closing Desk leaves these native terminals running; reopening a closed CLI recreates its tab.
- Materialize new conversations before their first message while keeping startup modes available. Explicit startup changes immediately update the shared CLI; later CLI settings remain authoritative. Preserve text and images during asynchronous creation.
- Show bilingual background terminal status and a retry action. Standalone writers remain untouched and are connected after release; archived history does not launch a terminal.

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
