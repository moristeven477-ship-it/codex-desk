export type TailscaleSource = 'managed' | 'system';
export type SetupStage =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'installing'
  | 'starting'
  | 'login'
  | 'approval'
  | 'https'
  | 'serving'
  | 'ready'
  | 'error';
export type PhoneSetup = {
  stage: SetupStage;
  active: boolean;
  source?: TailscaleSource;
  progress?: number;
  actionUrl?: string;
  error?: string;
};
export type PhoneStatus = {
  enabled: boolean;
  port: number;
  publicOrigin: string;
  localOrigin: string;
  devices: { id: string; name: string; online: boolean }[];
  tailscale: { installed: boolean; state: string; url: string };
  setup: PhoneSetup;
};
