# Codex Desk

**专为 Codex CLI 开发的 Ubuntu 桌面工作空间。**

从零实现。采用 Electron、React、TypeScript；提供完整中文和英文界面，以及深色、浅色主题。

[下载 Ubuntu 安装包](https://github.com/moristeven477-ship-it/codex-desk/releases/latest) · [English](README.md)

![Codex Desk 中文深色界面](docs/screenshots/workspace-zh.png)

_截图使用测试项目，应用实际连接本机 Codex CLI。_

## 主要功能

- 管理项目目录，按项目或标题查找会话。
- 读取并继续已有 CLI、IDE、app-server 历史会话，支持分页。
- 新建、重命名、分叉、归档和恢复会话。
- 实时显示回复、命令输出、思考摘要、执行计划与文件修改。
- 多个会话分别运行；随时停止当前任务。
- 在界面中处理命令、文件和权限审批，以及 Codex 的问题。
- 选择模型、推理强度、权限模式；使用原生文件选择器添加图片。
- 浏览项目文件，查看 Git 暂存、未暂存和未跟踪更改。
- 中英文切换，深浅色主题，侧栏与文件面板调整。

## 安装

发布目标为 **Ubuntu 24.04、x86-64**，其他系统和架构尚未验证。

### 准备 Codex CLI

如果终端中已经能使用 Codex，可以保留现有安装与登录状态。否则先安装并登录：

```bash
npm install -g @openai/codex
codex login
```

应用会自动查找常用 npm、nvm、Volta 和本地可执行文件目录。找不到时，可在「设置 → Codex CLI」中填写完整路径。已验证 CLI 版本为 **0.154.0**。

### Ubuntu 安装包

从 [Releases](https://github.com/moristeven477-ship-it/codex-desk/releases/latest) 下载 `.deb`：

```bash
sudo apt install ./codex-desk-0.1.0-amd64.deb
```

安装后在 Ubuntu 应用菜单中打开 **Codex Desk**，或运行 `codex-desk`。

也可下载便携 AppImage：

```bash
chmod +x codex-desk-0.1.0-x86_64.AppImage
./codex-desk-0.1.0-x86_64.AppImage
```

没有 FUSE 时：

```bash
APPIMAGE_EXTRACT_AND_RUN=1 ./codex-desk-0.1.0-x86_64.AppImage
```

Ubuntu 24.04 优先使用 `.deb`，安装器包含 Electron 的 AppArmor 集成。遇到沙箱错误时参考[故障排查](docs/TROUBLESHOOTING.md)，不要通过关闭沙箱解决。

## 开始使用

1. 在左侧打开一个项目文件夹。
2. 选择历史会话，或新建会话。
3. 在输入框下选择模型、推理强度和权限模式。
4. 描述任务，查看执行进度，并在需要时回答或授权。
5. 在右侧浏览文件与代码差异。

默认允许修改项目，并按需请求授权；也可以选择只读或完全访问。权限由 Codex 执行。

「设置 → 通用 → 界面语言」可切换 English / 简体中文。「外观」可切换深浅色，设置自动保存。

| 快捷键        | 操作     |
| ------------- | -------- |
| `Ctrl+N`      | 新会话   |
| `Ctrl+K`      | 搜索会话 |
| `Ctrl+,`      | 设置     |
| `Enter`       | 发送     |
| `Shift+Enter` | 换行     |

## 数据与边界

应用直接通过 stdio 连接本机 `codex app-server`，不启动 HTTP 服务，不提供云中转，不收集应用遥测。

- 会话与登录凭证仍由 Codex 管理，通常位于 `~/.codex`。
- 项目书签与偏好通常位于 `~/.config/Codex Desk/state.json`。
- 应用不另行复制 API Key 或 Codex 登录文件；模型仍使用原有订阅额度或 API 计费。
- 文件面板是只读预览；文件编辑由 Codex 完成。移除书签不会删除项目文件。
- 可以恢复已有 CLI 历史，但不会自动接管另一个正在运行的 CLI 进程输出。请先结束原 CLI 的任务，再在这里继续同一会话。
- 退出应用会关闭由它启动的 Codex 进程；仍有运行任务时会提示。
- 本版不含远程访问、自动更新、定时任务或其他模型代理的接入。
- MCP 表单暂用 JSON 字段回答；尚未实现的客户端协议请求会明确拒绝。

## 从源码运行

需要 Node.js 22.16+、npm，以及能正常使用的 Codex CLI。

```bash
git clone https://github.com/moristeven477-ship-it/codex-desk.git
cd codex-desk
npm ci
npm run dev
```

```bash
npm test
npm run test:e2e
npm run build
npm run package:linux
```

首次运行浏览器测试需要 `npx playwright install chromium`，或本机已有 Google Chrome。

可选真实 CLI 检查：`npm run test:live` 只读取连接、模型与历史；加上 `-- --turn` 会创建一次隔离的只读测试对话，使用你的额度，并在结束后归档该测试会话。

## 开源

[MIT 协议](LICENSE)。布局参考 Qoder 的项目工作区与 ChatGPT 的对话交互，代码、样式与图标均为独立实现。本项目与 OpenAI、Qoder 无隶属关系。

另见[第三方许可证](THIRD_PARTY_NOTICES.txt)与[验证记录](docs/VALIDATION.md)。
