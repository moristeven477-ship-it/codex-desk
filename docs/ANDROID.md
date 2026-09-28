# Android + Tailscale

[English](#english) · [简体中文](#简体中文)

## English

Codex Desk for Android controls the Codex CLI running on your Ubuntu computer. It uses the same threads, history, model settings, permissions, approvals and goals as Desk and the shared CLI. Codex runs on the computer; the phone does not need a separate Codex installation or API key.

![Android phone layout — synthetic workspace](screenshots/android-phone.png)

### Install and pair

1. Install **Codex Desk 0.3.0 or later** on Ubuntu and `codex-desk-0.3.0-android.apk` from [Releases](https://github.com/moristeven477-ship-it/codex-desk/releases/latest) on Android 8.0 or later. Allow your browser/file manager to install this APK when Android asks. Keep Android System WebView or Chrome updated.
2. Install [Tailscale on Android](https://tailscale.com/download/android) and [Ubuntu](https://tailscale.com/download/linux). Sign both into the same tailnet, and turn on Tailscale on the phone.
3. In desktop **Settings → Phone access**, choose **Enable access**, then **Configure Tailscale address**. On first use, Tailscale may provide a link to enable HTTPS for your tailnet. Open that link, enable HTTPS, then retry the button. A system installation may require its administrator to grant this user Tailscale operator access: `sudo tailscale set --operator="$USER"`.
4. Copy the resulting `https://computer.tailXXXX.ts.net:8443` address into the Android app. Use the complete HTTPS address, including `:8443`.
5. On the computer, select **Create pairing code**. Enter that code and a device name on the phone. Codes expire after five minutes and work once. Paired sessions last 30 days; generate a new code to pair again when needed.

Closing the desktop window leaves Desk in the system tray while phone access is enabled. The computer must remain powered on, awake and logged in, with Desk running. **Quit** in the tray disconnects the phone; it does not terminate the shared Codex server or running tasks. Desk is not automatically started after reboot: launch it again after signing in.

Tailscale identifies each device independently of its Wi-Fi/cellular address. Changing networks does not require editing the computer address or allowlisting the phone's current public IP. MagicDNS is preferable to a numeric IP because Tailscale provides a valid HTTPS certificate for that hostname. See [Tailscale IP addresses](https://tailscale.com/docs/concepts/tailscale-ip-addresses) and [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

### Using the phone

- Send tasks, choose a startup mode, change model/effort/Fast, interrupt, or steer a running task. CLI settings win until you explicitly change a setting in Desk or Android.
- Pending steering remains visible. After a network change, the app reloads authoritative thread history. It never automatically resends submitted prompts or steering. If delivery is uncertain, inspect the conversation before sending again.
- Open history in the left drawer. Project paths refer to folders **on the computer**; enter their absolute paths when adding a project.
- Attach images with the Android document picker or paste supported clipboard images. Images are transferred to the computer and stored as private PNG files for Codex. Limit: eight per message, 20 MiB each.
- The `/` menu, goals, approvals, file/Git inspector and embedded actual Codex CLI are available. Mobile selection does not spawn Ubuntu Terminal tabs or change the desktop's selected conversation.
- Phone language, theme and font size are independent of the desktop. Project bookmarks and Codex settings are shared.
- Task-completion banners appear while the mobile interface is active. Android background push notifications are not included. Suspended WebViews reconnect when brought back to the foreground.
- Revoke a device in desktop **Phone access**, or choose **Unpair this phone** in mobile settings. This immediately ends that device's remote access and its embedded terminal connection, without stopping its running Codex task.

### Optional rootless Ubuntu setup

If you cannot install system packages, the repository includes a helper for Ubuntu x86-64 with Node.js 22:

```bash
node scripts/setup-tailscale-user.mjs
```

It downloads a checksum-verified official static Tailscale distribution and runs a private userspace-networking daemon as `codex-desk-tailscale.service` under the current user's systemd. It uses no root privileges, adds no system VPN interface, and does not change system DNS. Follow its login link, then configure the address in Desk. This private endpoint is intended for inbound phone access to Desk, not as a system-wide VPN.

Data: `~/.local/share/codex-desk/tailscale/`. Logs: `journalctl --user -u codex-desk-tailscale.service`. Stop/remove its autostart with `systemctl --user disable --now codex-desk-tailscale.service`. If switching to a system Tailscale installation, disable this helper and configure the desktop address again.

### Connection and trust

The gateway listens only on `127.0.0.1:43125`. Tailscale Serve forwards tailnet HTTPS on port 8443 to it. There is no router port-forwarding and no Tailscale Funnel. Tailnet ACLs must allow your phone to reach this computer on TCP 8443.

A paired phone can control your coding agent with the same authority you grant through Codex, including explicit YOLO mode. Pair only your own trusted devices. A separate random session is kept in an HttpOnly, Secure, SameSite cookie. Only its hash is stored in the computer's private `remote.json`; pairing codes are kept in memory. Android validates TLS, blocks cleartext connections and uses no JavaScript-to-native bridge. The desktop can revoke access at any time. See [Security](../SECURITY.md).

If the phone cannot connect, check Tailscale is on, both devices are in the same tailnet, the computer is awake, Desk is running, and the full `https://…ts.net:8443` address matches desktop settings. A certificate error requires fixing Tailscale HTTPS or the device clock; the app does not bypass certificate errors.

### Build Android from source

Requirements: JDK 17, Android SDK platform 36, build-tools 35.0.0. The Gradle wrapper pins Gradle 8.13 with its distribution checksum. No Google Play services or account SDK is included.

```bash
cd android
./gradlew :app:testDebugUnitTest :app:lintRelease :app:assembleDebug
```

Install `app/build/outputs/apk/debug/app-debug.apk` for development. `assembleRelease` produces an unsigned release APK. The distributed release is signed with the maintainer's private key, kept outside the repository. Future official updates use that same key; self-built APKs need their own key and cannot replace an official installation without uninstalling it first. Back up the signing key when maintaining your own distribution. Run `JAVA_HOME=… ANDROID_HOME=… node scripts/sign-android.mjs` from the repository root to create or reuse a private release key under `~/.local/share/codex-desk/android-signing/`, align/sign the release APK, verify it and export the public certificate to `android/release-cert.pem`. Never commit that private signing directory.

## 简体中文

安卓版控制的是 **Ubuntu 电脑上正在运行的 Codex CLI**。手机、Desk、共享 CLI 使用同一会话、消息、权限、模型、审批和 goal；手机无需另装 Codex 或填写 API 密钥。

### 安装和配对

1. 从 [Releases](https://github.com/moristeven477-ship-it/codex-desk/releases/latest) 安装电脑端 0.3.0 或更新版本，以及 `codex-desk-0.3.0-android.apk`。支持 Android 8.0 起；按安卓提示允许安装此 APK，并保持系统 WebView / Chrome 更新。
2. [手机](https://tailscale.com/download/android)和[电脑](https://tailscale.com/download/linux)安装 Tailscale，登录同一个网络，手机打开 Tailscale。
3. 电脑端「设置 → 手机连接 → 启用连接 → 配置 Tailscale 地址」。首次可能需要按 Tailscale 给出的链接启用 HTTPS，再点击配置。系统安装的 Tailscale 若提示权限不足，管理员可运行 `sudo tailscale set --operator="$USER"`。
4. 将电脑显示的完整 `https://电脑名.tailXXXX.ts.net:8443` 填入安卓 App，保留 `:8443`。
5. 电脑端点击「生成配对码」，在手机输入配对码和设备名称。配对码一次有效、五分钟过期；配对登录保留 30 天，可在电脑端随时撤销。

手机切换 Wi-Fi / 流量、外网 IP 改变都不需要重新设置电脑地址。使用 Tailscale 提供的固定设备域名和 HTTPS，电脑不需要公网端口映射。

启用手机连接后，关闭 Desk 窗口会留在托盘运行；托盘「退出」会断开手机，但不终止共享 Codex 任务。电脑需要保持开机、唤醒、已登录且 Desk 在运行；电脑重启登录后需重新打开 Desk。

### 手机操作

- 支持新会话启动模式、历史消息、模型/推理/Fast、停止、插话、审批、goal、`/` 菜单、文件/Git 查看及真实 CLI 终端。
- 一切以 CLI 设置为优先，只有主动修改时才覆盖。手机切换会话不抢占桌面当前页面，也不自动打开 Ubuntu Terminal 标签页。
- 插话立即可见；断网重连后以 CLI 历史校准。已提交内容不会自动重发，发送结果不确定时先查看会话。
- 图片通过安卓文件选择器添加，也支持浏览器能读取的剪贴板图片。图片保存在电脑侧，每条最多八张、每张 20 MiB。
- 添加项目时填写电脑上的绝对路径。手机语言、主题和字号独立保存，项目书签和 Codex 状态共享。
- App 活跃时显示顶部完成提示；暂未实现 Android 后台推送。返回 App 后会重连并更新历史。
- 在电脑「手机连接」撤销设备，或手机设置中「取消手机配对」，可结束访问；运行中的 Codex 任务仍保留。

没有系统安装权限时，可在仓库运行 `node scripts/setup-tailscale-user.mjs`。它为 Ubuntu x86-64 安装校验过的官方 Tailscale 到用户目录，使用用户级 systemd 和 userspace networking，不修改系统 DNS。完成输出的登录链接，再到 Desk 配置地址。详情见上面的英文说明。

连接失败时依次确认 Tailscale 已打开、双方属于同一网络、电脑未休眠、Desk 已运行、地址含 HTTPS 和 `:8443`。首次需启用 Tailscale HTTPS，网络 ACL 需允许手机访问电脑 TCP 8443。证书错误不能跳过，应修正 HTTPS 配置或设备时间。
