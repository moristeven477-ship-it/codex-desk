// Command names and aliases checked against openai/codex rust-v0.154.0,
// codex-rs/tui/src/slash_command.rs. The installed TUI remains the executor
// for terminal commands and decides platform / feature availability.
export interface SlashCommand {
  name: string;
  zh: string;
  en: string;
  native?: boolean;
  advanced?: boolean;
  aliases?: string[];
}
export const slashCommands: SlashCommand[] = [
  { name: 'goal', zh: '目标与进度', en: 'Goal and progress', native: true },
  { name: 'plan', zh: '切换计划模式', en: 'Plan mode', native: true },
  { name: 'status', zh: '会话状态', en: 'Session status', native: true },
  { name: 'model', zh: '模型与推理强度', en: 'Model and reasoning', native: true },
  { name: 'fast', zh: 'Fast 模式：on / off / status', en: 'Fast mode: on / off / status', native: true },
  { name: 'permissions', zh: '权限设置', en: 'Permissions', native: true },
  { name: 'new', zh: '新建会话', en: 'New conversation', native: true },
  { name: 'resume', zh: '继续历史会话', en: 'Resume a conversation', native: true },
  { name: 'rename', zh: '重命名会话', en: 'Rename conversation', native: true },
  { name: 'fork', zh: '分叉会话', en: 'Fork conversation', native: true },
  { name: 'compact', zh: '压缩上下文', en: 'Compact context', native: true },
  { name: 'diff', zh: '查看代码更改', en: 'View changes', native: true },
  { name: 'mention', zh: '选择引用文件', en: 'Mention a file', native: true },
  { name: 'copy', zh: '复制回复', en: 'Copy a response' },
  { name: 'clear', zh: '清屏并新建会话', en: 'Clear and start fresh', native: true },
  { name: 'archive', zh: '归档会话', en: 'Archive conversation', native: true },
  { name: 'delete', zh: '删除会话', en: 'Delete conversation' },
  { name: 'review', zh: '代码审查', en: 'Code review' },
  { name: 'recap', zh: '会话回顾', en: 'Conversation recap' },
  { name: 'init', zh: '项目指令文件', en: 'Project instructions' },
  { name: 'worktree', zh: 'Git 工作树', en: 'Git worktree' },
  { name: 'agents', zh: '所有代理会话', en: 'Agent sessions' },
  { name: 'subagents', zh: '当前会话的子代理', en: 'Session subagents' },
  { name: 'side', zh: '临时旁支对话', en: 'Side conversation' },
  { name: 'btw', zh: '临时旁支对话', en: 'Side conversation' },
  { name: 'skills', zh: '技能', en: 'Skills' },
  { name: 'plugins', zh: '插件', en: 'Plugins' },
  { name: 'apps', zh: '应用连接', en: 'App connections' },
  { name: 'mcp', zh: 'MCP 工具', en: 'MCP tools' },
  { name: 'hooks', zh: '生命周期钩子', en: 'Lifecycle hooks' },
  { name: 'memories', zh: '记忆设置', en: 'Memory settings' },
  { name: 'import', zh: '导入配置与会话', en: 'Import setup and chats' },
  { name: 'ide', zh: 'IDE 上下文', en: 'IDE context' },
  { name: 'export', zh: '导出对话', en: 'Export conversation' },
  { name: 'raw', zh: '终端原始视图', en: 'Raw terminal view' },
  { name: 'cd', zh: '更换会话目录', en: 'Change directory' },
  { name: 'pwd', zh: '当前目录', en: 'Current directory', native: true, aliases: ['cwd'] },
  { name: 'usage', zh: '账户用量', en: 'Account usage' },
  { name: 'ps', zh: '后台终端', en: 'Background terminals' },
  { name: 'stop', zh: '停止后台终端', en: 'Stop background terminals', aliases: ['clean'] },
  { name: 'personality', zh: '沟通风格', en: 'Communication style' },
  { name: 'keymap', zh: '终端快捷键', en: 'Terminal shortcuts' },
  { name: 'vim', zh: 'Vim 输入模式', en: 'Vim input mode' },
  { name: 'theme', zh: '终端语法主题', en: 'Terminal syntax theme' },
  { name: 'title', zh: '终端标题', en: 'Terminal title' },
  { name: 'statusline', zh: '终端状态栏', en: 'Terminal status line' },
  { name: 'pets', zh: '终端宠物', en: 'Terminal pet', aliases: ['pet'] },
  { name: 'experimental', zh: '实验功能', en: 'Experimental features' },
  { name: 'approve', zh: '重试自动审批', en: 'Retry automatic approval' },
  { name: 'debug-config', zh: '配置来源', en: 'Configuration sources' },
  { name: 'logout', zh: '退出账户', en: 'Sign out' },
  { name: 'feedback', zh: '反馈给 Codex', en: 'Codex feedback' },
  { name: 'quit', zh: '退出 CLI', en: 'Quit CLI' },
  { name: 'exit', zh: '退出 CLI', en: 'Exit CLI' },
  // Also retain gated commands for completeness; no feature flags are forced.
  { name: 'setup-default-sandbox', zh: '平台沙箱设置', en: 'Platform sandbox setup', advanced: true },
  { name: 'sandbox-add-read-dir', zh: 'Windows 沙箱目录', en: 'Windows sandbox directory', advanced: true },
  {
    name: 'app',
    zh: '官方桌面应用（macOS / Windows）',
    en: 'Official desktop app (macOS / Windows)',
    advanced: true,
  },
  { name: 'rollout', zh: '调试构建：会话路径', en: 'Debug build: session path', advanced: true },
  { name: 'test-approval', zh: '调试构建：审批', en: 'Debug build: approval', advanced: true },
  {
    name: 'debug-m-drop',
    zh: '内部记忆调试：上游标记为勿用',
    en: 'Internal memory debug: upstream says do not use',
    advanced: true,
  },
  {
    name: 'debug-m-update',
    zh: '内部记忆调试：上游标记为勿用',
    en: 'Internal memory debug: upstream says do not use',
    advanced: true,
  },
];
export function parseSlash(input: string) {
  const match = /^\/([^\s]*)\s*([\s\S]*)$/.exec(input.trim());
  if (!match) return null;
  const entry = slashCommands.find(
    (command) => command.name === match[1] || command.aliases?.includes(match[1]),
  );
  return { name: entry?.name || match[1], args: match[2], entry };
}
