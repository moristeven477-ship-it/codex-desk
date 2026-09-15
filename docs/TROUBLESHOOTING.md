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

Try `APPIMAGE_EXTRACT_AND_RUN=1 ./codex-desk-0.1.0-x86_64.AppImage`. This avoids requiring FUSE. Use the `.deb` if your system still blocks the portable binary.

## A conversation is missing / 找不到会话

- Select **All conversations**, clear the search field, and check the archive toggle.
- Check that the configured `CODEX_HOME` matches your CLI installation.
- Project filtering matches Codex's exact working directory, not every nested directory.
- The list includes interactive CLI/IDE/app-server sessions and `codex exec` sessions. Subagent-only threads are not listed.

The app polls the visible history list every 15 seconds and refreshes on focus. It does not stream a separate CLI process's live output. Finish the original turn before resuming it in this app.

## Settings recovery / 设置恢复

Preferences are normally in `~/.config/Codex Desk/state.json`. On malformed JSON or an incompatible shape, the original is retained as `state.corrupt-<timestamp>.json` before defaults are used. Close the app before restoring a saved copy. Codex history and authentication are separate and are not removed by preference recovery.

## Git / files

The inspector is read-only. It hides `.git`, `node_modules`, common build output and cache directories. A folder shows up to 500 entries. Text preview accepts regular files up to 1 MiB and rejects binary files and symlink escapes. Git output is bounded and external diff/textconv helpers are disabled.

## Reporting a bug

Include the application version, Ubuntu version, `codex --version`, and reproduction steps. Remove credentials, project contents, personal paths and conversation details from screenshots or logs before sharing. Use a disposable project where possible.
