# Slash command inventory / 命令清单

Codex CLI 0.154.0: all 60 definitions, including aliases and gated entries. Checked against [the pinned upstream definition](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/tui/src/slash_command.rs).

The installed real TUI executes CLI commands. Insert a command at its prompt and press Enter. Graphical routes accept their supported simple form; commands with additional arguments can open the real TUI. Custom and future commands can be entered directly in the embedded terminal. Conditional entries retain upstream platform, build, or feature requirements. Terminal settings affect the terminal surface.

内置终端执行标记为 CLI 的命令。条件可用项保留上游的平台、调试或实验限制；不会强制启用。图形入口处理常用形式，带额外参数时可交给真实 CLI。自定义或后续新增命令可直接在终端输入。

| Command                | 中文                            | English                                         | Surface                      |
| ---------------------- | ------------------------------- | ----------------------------------------------- | ---------------------------- |
| /goal                  | 目标与进度                      | Goal and progress                               | Desk / 图形界面              |
| /plan                  | 切换计划模式                    | Plan mode                                       | Desk / 图形界面              |
| /status                | 会话状态                        | Session status                                  | Desk / 图形界面              |
| /model                 | 模型与推理强度                  | Model and reasoning                             | Desk / 图形界面              |
| /permissions           | 权限设置                        | Permissions                                     | Desk / 图形界面              |
| /new                   | 新建会话                        | New conversation                                | Desk / 图形界面              |
| /resume                | 继续历史会话                    | Resume a conversation                           | Desk / 图形界面              |
| /rename                | 重命名会话                      | Rename conversation                             | Desk / 图形界面              |
| /fork                  | 分叉会话                        | Fork conversation                               | Desk / 图形界面              |
| /compact               | 压缩上下文                      | Compact context                                 | Desk / 图形界面              |
| /diff                  | 查看代码更改                    | View changes                                    | Desk / 图形界面              |
| /mention               | 选择引用文件                    | Mention a file                                  | Desk / 图形界面              |
| /copy                  | 复制回复                        | Copy a response                                 | CLI                          |
| /clear                 | 清屏并新建会话                  | Clear and start fresh                           | Desk / 图形界面              |
| /archive               | 归档会话                        | Archive conversation                            | Desk / 图形界面              |
| /delete                | 删除会话                        | Delete conversation                             | CLI                          |
| /review                | 代码审查                        | Code review                                     | CLI                          |
| /recap                 | 会话回顾                        | Conversation recap                              | CLI                          |
| /init                  | 项目指令文件                    | Project instructions                            | CLI                          |
| /worktree              | Git 工作树                      | Git worktree                                    | CLI                          |
| /agents                | 所有代理会话                    | Agent sessions                                  | CLI                          |
| /subagents             | 当前会话的子代理                | Session subagents                               | CLI                          |
| /side                  | 临时旁支对话                    | Side conversation                               | CLI                          |
| /btw                   | 临时旁支对话                    | Side conversation                               | CLI                          |
| /skills                | 技能                            | Skills                                          | CLI                          |
| /plugins               | 插件                            | Plugins                                         | CLI                          |
| /apps                  | 应用连接                        | App connections                                 | CLI                          |
| /mcp                   | MCP 工具                        | MCP tools                                       | CLI                          |
| /hooks                 | 生命周期钩子                    | Lifecycle hooks                                 | CLI                          |
| /memories              | 记忆设置                        | Memory settings                                 | CLI                          |
| /import                | 导入配置与会话                  | Import setup and chats                          | CLI                          |
| /ide                   | IDE 上下文                      | IDE context                                     | CLI                          |
| /export                | 导出对话                        | Export conversation                             | CLI                          |
| /raw                   | 终端原始视图                    | Raw terminal view                               | CLI                          |
| /cd                    | 更换会话目录                    | Change directory                                | CLI                          |
| /pwd · /cwd            | 当前目录                        | Current directory                               | Desk / 图形界面              |
| /usage                 | 账户用量                        | Account usage                                   | CLI                          |
| /ps                    | 后台终端                        | Background terminals                            | CLI                          |
| /stop · /clean         | 停止后台终端                    | Stop background terminals                       | CLI                          |
| /personality           | 沟通风格                        | Communication style                             | CLI                          |
| /keymap                | 终端快捷键                      | Terminal shortcuts                              | CLI                          |
| /vim                   | Vim 输入模式                    | Vim input mode                                  | CLI                          |
| /theme                 | 终端语法主题                    | Terminal syntax theme                           | CLI                          |
| /title                 | 终端标题                        | Terminal title                                  | CLI                          |
| /statusline            | 终端状态栏                      | Terminal status line                            | CLI                          |
| /pets · /pet           | 终端宠物                        | Terminal pet                                    | CLI                          |
| /experimental          | 实验功能                        | Experimental features                           | CLI                          |
| /approve               | 重试自动审批                    | Retry automatic approval                        | CLI                          |
| /debug-config          | 配置来源                        | Configuration sources                           | CLI                          |
| /logout                | 退出账户                        | Sign out                                        | CLI                          |
| /feedback              | 反馈给 Codex                    | Codex feedback                                  | CLI                          |
| /quit                  | 退出 CLI                        | Quit CLI                                        | CLI                          |
| /exit                  | 退出 CLI                        | Exit CLI                                        | CLI                          |
| /setup-default-sandbox | 平台沙箱设置                    | Platform sandbox setup                          | CLI · Conditional / 条件可用 |
| /sandbox-add-read-dir  | Windows 沙箱目录                | Windows sandbox directory                       | CLI · Conditional / 条件可用 |
| /app                   | 官方桌面应用（macOS / Windows） | Official desktop app (macOS / Windows)          | CLI · Conditional / 条件可用 |
| /rollout               | 调试构建：会话路径              | Debug build: session path                       | CLI · Conditional / 条件可用 |
| /test-approval         | 调试构建：审批                  | Debug build: approval                           | CLI · Conditional / 条件可用 |
| /debug-m-drop          | 内部记忆调试：上游标记为勿用    | Internal memory debug: upstream says do not use | CLI · Conditional / 条件可用 |
| /debug-m-update        | 内部记忆调试：上游标记为勿用    | Internal memory debug: upstream says do not use | CLI · Conditional / 条件可用 |
