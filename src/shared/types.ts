export type JsonObject = Record<string, unknown>;
export type Locale = 'zh' | 'en';
export type AccessMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type PermissionMode = AccessMode | 'external-sandbox';
export type ApprovalPolicy = string | JsonObject;
export type CollaborationMode = 'default' | 'plan';
export type GoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete';
export interface ThreadGoal {
  threadId: string;
  objective: string;
  status: GoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}
export interface Settings {
  binaryPath: string;
  codexHome: string;
  defaultWorkspace: string;
  locale: Locale;
  theme: 'dark' | 'light';
  fontSize: number;
  lastProjectId: string;
  lastThreadId: string;
}
export interface AppState {
  projects: Project[];
  settings: Settings;
}
export interface Connection {
  phase: 'stopped' | 'starting' | 'ready' | 'error';
  version?: string;
  binary?: string;
  codexHome?: string;
  error?: string;
  pid?: number;
  shared?: boolean;
  endpoint?: string;
}
export interface Input {
  type: string;
  text?: string;
  text_elements?: unknown[];
  path?: string;
  url?: string;
  name?: string;
}
export interface Item {
  id: string;
  type: string;
  text?: string;
  content?: Input[] | string[];
  summary?: string[];
  command?: string;
  cwd?: string;
  status?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
  changes?: { path: string; kind: { type: string }; diff: string }[];
  tool?: string;
  server?: string;
  result?: unknown;
  arguments?: unknown;
  error?: unknown;
  phase?: string | null;
  receiverThreadIds?: string[];
  [key: string]: unknown;
}
export interface Turn {
  id: string;
  items: Item[];
  status: 'inProgress' | 'completed' | 'interrupted' | 'failed';
  error?: { message: string } | null;
}
export interface Thread {
  id: string;
  path?: string | null;
  name?: string | null;
  preview: string;
  cwd: string;
  model?: string | null;
  reasoningEffort?: string | null;
  modelProvider?: string;
  source?: unknown;
  createdAt: number;
  updatedAt: number;
  status: { type: string; activeFlags?: string[] };
  turns: Turn[];
  historyMode?: string;
  nextTurnsCursor?: string | null;
  syncState?: 'live' | 'external';
  permissionMode?: PermissionMode;
  approvalPolicy?: ApprovalPolicy;
  approvalsReviewer?: string;
  sandboxPolicy?: JsonObject;
  activePermissionProfile?: { id: string; extends?: string | null } | null;
  collaborationMode?: CollaborationMode;
  goal?: ThreadGoal | null;
  gitInfo?: { sha?: string | null; branch?: string | null; originUrl?: string | null } | null;
}
export interface Model {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
}
export interface Approval {
  id: string | number;
  method: string;
  params: JsonObject;
  receivedAt: number;
}
export interface Question {
  id: string;
  question: string;
  header: string;
  isSecret?: boolean;
  options?: { label: string; description: string }[] | null;
}
export interface CodexEvent {
  kind: 'notification' | 'request' | 'connection' | 'resolved' | 'notice' | 'terminal' | 'navigate';
  threadId?: string;
  method?: string;
  params?: JsonObject;
  request?: Approval;
  connection?: Connection;
  id?: string | number;
  message?: string;
  terminalId?: string;
  data?: string;
  exitCode?: number;
}
export interface Bootstrap extends AppState {
  connection: Connection;
  models: Model[];
  account: { type: string; email?: string; planType?: string } | null;
  approvals: Approval[];
  appVersion: string;
  defaultWorkspace: string;
}
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
}
export interface GitFile {
  path: string;
  oldPath?: string;
  index: string;
  working: string;
}
export interface GitStatus {
  isRepo: boolean;
  branch: string;
  files: GitFile[];
  added: number;
  removed: number;
}
export interface FilePreview {
  path: string;
  content: string;
  language: string;
}
export interface ImageAttachment {
  path: string;
  name: string;
  preview: string;
}
export interface ImageUpload {
  name: string;
  bytes: Uint8Array;
}
export interface NativeBridge {
  request<T = unknown>(method: string, params?: JsonObject): Promise<T>;
  subscribe(listener: (event: CodexEvent) => void): () => void;
  pickDirectory(): Promise<string | null>;
  pickImages(): Promise<ImageAttachment[]>;
  importImages(images: ImageUpload[]): Promise<ImageAttachment[]>;
  copyText(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openTerminal(threadId: string): Promise<void>;
  prepareTerminal(threadId: string): Promise<{ state: 'ready' | 'waiting' | 'error'; error?: string }>;
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
}
declare global {
  interface Window {
    codexDesk?: NativeBridge;
  }
}
