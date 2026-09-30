export interface UpdateState {
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'current' | 'unsupported' | 'error';
  version?: string;
  progress?: number;
  checkedAt?: number;
  error?: string;
}
