# Troubleshooting / 故障排查

## Codex is not found / 找不到 Codex

Run `command -v codex` in your terminal. Set that absolute path in **Settings → Codex CLI → Codex executable**, then **Save & connect**. Ubuntu application-menu launchers may have a different PATH from your interactive terminal. Common npm/nvm/Volta paths are discovered automatically.

在终端运行 `command -v codex`，将完整路径填入「设置 → Codex CLI → Codex 可执行文件」，点击「保存并连接」。应用菜单与终端的 PATH 可能不同。

If authentication is missing, run `codex login` or use the in-app sign-in button. The `CODEX_HOME` setting must point to the home directory belonging to that login. Leave it blank to inherit Codex's default.

## Ubuntu sandbox / Ubuntu 沙箱

Use the `.deb` installer on Ubuntu 24.04. Its generated post-install script includes Electron's AppArmor profile and sandbox-helper setup. The app keeps context isolation and renderer sandboxing enabled. Both the unpacked application and AppImage extract-and-run path were tested on Ubuntu 24.04 without `--no-sandbox`.

If your machine's administrator has a stricter AppArmor or user-namespace policy, ask them to allow the installed application through the appropriate per-application policy. Do not globally disable the system policy or ship a `--no-sandbox` launcher.

Ubuntu 24.04 优先安装 `.deb`。若管理员另有沙箱限制，应通过单应用策略允许安装后的程序运行，不要关闭系统策略或使用禁用沙箱的启动器。

## AppImage does not mount / AppImage 无法挂载

Try `APPIMAGE_EXTRACT_AND_RUN=1 ./codex-desk-0.2.0-x86_64.AppImage`. This avoids requiring FUSE. Use the `.deb` if your system still blocks the portable binary.

## A conversation is missing / 找不到会话

- Select **All conversations**, clear the search field, and check the archive toggle.
- Check that the configured `CODEX_HOME` matches your CLI installation.
- Project filtering matches Codex's exact working directory, not every nested directory.
- The list includes interactive CLI/IDE/app-server sessions and `codex exec` sessions. Subagent-only threads are not listed.

The app polls the visible history list every three seconds and refreshes on focus. A subscribed conversation receives live events from the shared server.

## Active writer / 会话已被占用

A standalone CLI has its own engine and writer. Finish the task and exit that CLI once. Desk keeps the history readable, preserves drafts, and retries the same conversation every two seconds while visible. Use **CLI sync** to reopen it with `codex --remote unix:// resume THREAD_ID`; the two interfaces then share messages, approvals, settings, and goals. Never delete lock files or force another CLI to exit to work around this error.

独立 CLI 占用写入时，先完成任务并退出原 CLI。Desk 会保留历史和草稿，自动连接原会话；之后用「CLI 同步」重新打开。不要删除锁文件或强行结束其他会话。

## Shared server / 共享服务

The normal endpoint is `$CODEX_HOME/app-server-control/app-server-control.sock`. The CLI and Desk must use the same `CODEX_HOME`. The socket speaks WebSocket after an HTTP upgrade; it is not a JSON-lines pipe or a TCP listener. Closing Desk leaves the shared server running.

On npm installations, `codex app-server daemon start` can report that the managed standalone install is missing. Desk starts the official Unix listener directly in that case; no replacement Codex installation is necessary. Its startup log is `app-server-control/codex-desk-server.log` under Codex home. Reconnect in Settings after addressing a startup failure. Desk only removes a stale socket it previously created when its recorded process has exited.

Starting with 0.7.0, Desk displays the **running backend version**, separately from the installed CLI when they differ. With automatic updates enabled, it checks the installed CLI at connection time and every minute. A newer stable CLI replaces a Desk-owned backend once all shared threads and goals are idle. Live model, reasoning, speed and permission settings are restored. Running work, unknown activity, and listeners owned by other applications prevent automatic replacement. Updating the CLI package itself still uses your existing installation method.

从 0.7.0 起，设置显示**实际后台版本**；若与已安装 CLI 不同，会分别显示。开启自动更新后，连接时和每分钟检查一次。发现 CLI 新版后，等待所有共享会话及目标空闲，再更新 Desk 创建的后台，并恢复模型、推理、速度和权限设置。有任务运行、无法确认任务状态或后台由其他程序管理时，不会自动终止后台。CLI 软件包仍通过原安装方式升级。

## Automatic Desk updates / Desk 自动更新

**Settings → General → Automatic updates** is enabled by default. Writable, user-owned AppImages check this project's stable GitHub releases within a minute of launch and every six hours. Desk verifies the release asset's SHA-256 and length before installation. It waits until Codex has no active shared tasks or goals, the computer has had no input for at least 60 seconds, and the desktop composer has no unsent image attachments, then installs and restarts automatically. **Check for updates** runs the download check immediately. Turning the setting off also disables automatic backend replacement.

Installation replaces the existing AppImage atomically so existing launchers keep working, and saves the previous executable as `<AppImage path>.previous`. To roll back, quit Desk, copy that backup over the AppImage, and reopen it. The updater does not use sudo. System `.deb` installations and development builds must use their package manager or source installation method instead. Download/verification failures leave the existing application available; use **Check for updates** to retry.

「设置 → 通用 → 自动更新」默认开启。个人目录中可写的 AppImage 会在启动后一分钟内、之后每六小时检查本项目的 GitHub 正式发布，下载并校验 SHA-256 和文件长度。所有共享任务及目标空闲、电脑连续 60 秒没有输入后，会自动安装并重启。「检查更新」可立即检查并下载。关闭开关也会停用自动后台切换。

更新以原子替换方式保留现有启动器路径，上一版保存在 `<AppImage 路径>.previous`。需要回退时，退出 Desk，将备份复制回原 AppImage 路径后重新打开。系统 `.deb` 安装及开发版本仍通过包管理器或源码更新。下载或校验失败不会替换现有安装。

## Startup mode blocks sending / 启动模式确认失败，无法发送

If Desk 0.4.0 reports **Codex has not confirmed the startup mode**, update the **computer app to 0.4.1 or later**. Codex does not emit a settings-change notification when you select an already active mode. Desk now also reads the live CLI settings to confirm that selection. Fast on/off uses the same fix. Changed permissions still require confirmation from Codex.

The Android 0.4.0 APK can use this fix without reinstallation. After updating the computer, reopen the conversation on the phone, or select the startup mode again, then send the saved draft. The app never automatically resends a message.

若 0.4.0 提示上述错误，请把**电脑端升级到 0.4.1 或更新版本**。CLI 已处于所选模式时不会重复发送设置变更通知，旧版 Desk 因而误报超时。修复后会回读 CLI 的实际设置，Fast 开关也一并修复；真正的权限变更仍须由 CLI 确认。

安卓 0.4.0 无需重装。电脑更新后，在手机上重新进入原会话，或重新选择启动模式，再发送保留的草稿即可。程序不会自动重发消息。

## Slash menu / 命令菜单

Click **/** next to the attachment button. Commands marked **CLI** open the real terminal inside Desk. Wait for its input prompt, click **Insert command**, then Enter. If the CLI displays a question or picker first, answer that before inserting the command. Terminal-specific shortcuts, Vim mode, colors, and pets belong to the CLI surface. Platform / debug / experimental commands keep their upstream restrictions.

点击附件旁 **/**。标记为 CLI 的命令会打开真实终端。先处理 CLI 的问题或选择器，再在输入提示处「填入命令」并按 Enter。平台和实验限制仍由 Codex 判断。

The embedded terminal requires `/usr/bin/python3`, included in standard Ubuntu 24.04 installations. The app uses only its standard library. If Python is missing, install the Ubuntu `python3` package.

## Settings recovery / 设置恢复

Preferences are normally in `~/.config/Codex Desk/state.json`. On malformed JSON or an incompatible shape, the original is retained as `state.corrupt-<timestamp>.json` before defaults are used. Close the app before restoring a saved copy. Codex history and authentication are separate and are not removed by preference recovery.

Draft text is stored separately in the application's renderer local storage. Back up the entire application data directory when moving drafts between installations.

## Git / files

The inspector is read-only. It hides `.git`, `node_modules`, common build output and cache directories. A folder shows up to 500 entries. Text preview accepts regular files up to 1 MiB and rejects binary files and symlink escapes. Git output is bounded and external diff/textconv helpers are disabled.

## Reporting a bug

Include the application version, Ubuntu version, `codex --version`, and reproduction steps. Remove credentials, project contents, personal paths and conversation details from screenshots or logs before sharing. Use a disposable project where possible.
