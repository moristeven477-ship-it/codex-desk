import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import type { PhoneSetup, TailscaleSource } from '../src/shared/remote';
import { installManagedTailscale, type Run } from './tailscale-install';

export const runTailscaleCommand: Run = (file, args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        signal: options.signal,
        timeout: options.timeout ?? 20_000,
        maxBuffer: 2_000_000,
      },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { output: stdout + stderr }));
        else resolve(stdout);
      },
    );
    child.stdout?.on('data', (data: Buffer) => options.output?.(data.toString()));
    child.stderr?.on('data', (data: Buffer) => options.output?.(data.toString()));
    child.stdin?.end();
  });

// Login URLs come from the local Tailscale daemon. Never open arbitrary CLI output.
export function tailscaleActionURL(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      url.hostname === 'login.tailscale.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      value.length < 4096
    )
      return url.href;
  } catch {
    /* Invalid URLs are not actions. */
  }
}
function outputURL(text: string) {
  return text
    .match(/https:\/\/[^\s"<>]+/g)
    ?.map(tailscaleActionURL)
    .find(Boolean);
}
export type TailscaleNode = { state: string; dns: string; url: string; authUrl?: string };
type ServeConfig = {
  TCP?: Record<string, { HTTPS?: boolean }>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  AllowFunnel?: Record<string, boolean>;
};
export function checkDeskServe(config: ServeConfig, dns: string, port: number) {
  const address = `${dns}:8443`,
    proxy = `http://127.0.0.1:${port}`;
  const handlers = config.Web?.[address]?.Handlers;
  const otherHost = Object.keys(config.Web ?? {}).some((host) => host.endsWith(':8443') && host !== address);
  const publicPort = Object.entries(config.AllowFunnel ?? {}).some(
    ([host, enabled]) => enabled && host.endsWith(':8443'),
  );
  if (
    otherHost ||
    publicPort ||
    (handlers && (Object.keys(handlers).some((key) => key !== '/') || handlers['/']?.Proxy !== proxy)) ||
    (config.TCP?.['8443'] && (!handlers || !config.TCP['8443'].HTTPS))
  )
    throw new Error(
      'Tailscale port 8443 belongs to another service. / Tailscale 8443 端口已由其他服务使用。',
    );
  return !!handlers && config.TCP?.['8443']?.HTTPS === true;
}
export interface TailscaleDriver {
  status(source: TailscaleSource, signal: AbortSignal): Promise<TailscaleNode | null>;
  install(signal: AbortSignal, update: (state: Partial<PhoneSetup>) => void): Promise<void>;
  connect(signal: AbortSignal, action: (url: string) => void): Promise<void>;
  serve(
    source: TailscaleSource,
    node: TailscaleNode,
    port: number,
    signal: AbortSignal,
    action: (url: string) => void,
  ): Promise<boolean>;
  wait(signal: AbortSignal): Promise<void>;
}
export function createTailscaleDriver(home = homedir(), run = runTailscaleCommand): TailscaleDriver {
  const root = path.join(home, '.local/share/codex-desk/tailscale');
  const command = (
    source: TailscaleSource,
    args: string[],
    signal: AbortSignal,
    output?: (text: string) => void,
    timeout?: number,
  ) =>
    run(
      source === 'managed' ? path.join(root, 'tailscale') : 'tailscale',
      source === 'managed' ? ['--socket=' + path.join(root, 'tailscaled.sock'), ...args] : args,
      { signal, output, timeout },
    );
  const driver: TailscaleDriver = {
    async status(source, signal) {
      try {
        const info = JSON.parse(await command(source, ['status', '--json'], signal, undefined, 5000));
        const dns = String(info.Self?.DNSName ?? '').replace(/\.$/, '');
        const validDNS = /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i.test(dns);
        return {
          state: String(info.BackendState),
          dns,
          url: validDNS ? `https://${dns}:8443` : '',
          authUrl: tailscaleActionURL(info.AuthURL),
        };
      } catch {
        signal.throwIfAborted();
        return null;
      }
    },
    async install(signal, update) {
      if (process.platform !== 'linux' || process.arch !== 'x64')
        throw new Error('Built-in setup requires Ubuntu x86-64. / 内置安装需要 Ubuntu x86-64。');
      await installManagedTailscale({ home, run, signal, update });
    },
    async connect(signal, action) {
      let output = '';
      try {
        await command(
          'managed',
          ['up', '--accept-dns=false', '--hostname=codex-desk', '--timeout=15s'],
          signal,
          (chunk) => {
            output += chunk;
            const url = outputURL(output);
            if (url) action(url);
          },
        );
      } catch (error) {
        signal.throwIfAborted();
        const node = await driver.status('managed', signal);
        if (!node || !['NeedsLogin', 'NeedsMachineAuth', 'Starting', 'Running'].includes(node.state))
          throw error;
      }
    },
    async serve(source, node, port, signal, action) {
      const readConfig = async () =>
        JSON.parse(await command(source, ['serve', 'status', '--json'], signal)) as ServeConfig;
      if (checkDeskServe(await readConfig(), node.dns, port)) return true;
      let output = '',
        needsAction = false;
      try {
        await command(
          source,
          ['serve', '--bg', '--yes', '--https=8443', `http://127.0.0.1:${port}`],
          signal,
          (chunk) => {
            output += chunk;
            const url = outputURL(output);
            if (url) {
              needsAction = true;
              action(url);
            }
          },
        );
      } catch (error) {
        signal.throwIfAborted();
        if (!needsAction) throw error;
      }
      // A successful CLI exit can still mean HTTPS needs browser authorization.
      const ready = checkDeskServe(await readConfig(), node.dns, port);
      if (!ready && !needsAction)
        throw new Error('Tailscale did not enable HTTPS. Please retry. / Tailscale 未能启用 HTTPS，请重试。');
      return ready;
    },
    async wait(signal) {
      await sleep(2500, undefined, { signal });
    },
  };
  return driver;
}

export class TailscaleSetup {
  private value: PhoneSetup = { stage: 'idle', active: false };
  private controller?: AbortController;
  private job?: Promise<void>;
  constructor(private driver = createTailscaleDriver()) {}
  get state(): PhoneSetup {
    return { ...this.value };
  }
  private update(state: Partial<PhoneSetup>) {
    this.value = { ...this.value, ...state };
  }
  async status(origin = '') {
    const signal = AbortSignal.timeout(6000);
    const nodes = await this.nodes(signal);
    const source = this.value.source ?? this.choose(nodes, origin);
    const node = source ? nodes[source] : null;
    return { installed: !!node, state: node?.state ?? 'Unavailable', url: node?.url ?? '' };
  }
  private async nodes(signal: AbortSignal) {
    const [managed, system] = await Promise.all([
      this.driver.status('managed', signal),
      this.driver.status('system', signal),
    ]);
    return { managed, system };
  }
  private choose(
    nodes: Record<TailscaleSource, TailscaleNode | null>,
    origin: string,
  ): TailscaleSource | undefined {
    for (const source of ['managed', 'system'] as const)
      if (
        origin &&
        nodes[source]?.url === origin &&
        (source === 'managed' || nodes[source]?.state === 'Running')
      )
        return source;
    if (nodes.managed?.state === 'Running') return 'managed';
    if (nodes.system?.state === 'Running') return 'system';
    return nodes.managed ? 'managed' : undefined;
  }
  start(port: number, origin: string, ready: (url: string) => Promise<unknown>) {
    if (this.controller) return this.state;
    const controller = new AbortController();
    this.controller = controller;
    this.value = { stage: 'checking', active: true };
    this.job = this.setup(port, origin, ready, controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        this.update({
          stage: 'error',
          actionUrl: undefined,
          progress: undefined,
          error: message.replace(/https:\/\/[^\s]+/g, '[link]').slice(0, 500),
        });
      })
      .finally(() => {
        if (this.controller === controller) {
          this.controller = undefined;
          this.update({ active: false });
        }
      });
    return this.state;
  }
  async cancel() {
    this.controller?.abort();
    await this.job;
    this.value = { stage: 'idle', active: false };
  }
  private async setup(
    port: number,
    origin: string,
    ready: (url: string) => Promise<unknown>,
    signal: AbortSignal,
  ) {
    const nodes = await this.nodes(signal);
    let source = this.choose(nodes, origin) ?? 'managed';
    let node = nodes[source];
    this.update({ source });
    if (source === 'managed' && !node) {
      await this.driver.install(signal, (state) => this.update(state));
      for (let tries = 0; tries < 12 && !node; tries++) {
        await this.driver.wait(signal);
        node = await this.driver.status(source, signal);
      }
    }
    let connected = false;
    let waitingWithoutLink = 0;
    const deadline = Date.now() + 30 * 60_000;
    for (;;) {
      signal.throwIfAborted();
      if (Date.now() > deadline)
        throw new Error(
          'Setup timed out. Click Retry setup to continue. / 设置等待超时，请点击重新设置继续。',
        );
      if (!node)
        throw new Error('Could not start Tailscale. Please retry setup. / 无法启动 Tailscale，请重新设置。');
      if (node.state !== 'Running') {
        if (source === 'managed' && !connected) {
          connected = true;
          this.update({ stage: 'starting', progress: undefined });
          await this.driver.connect(signal, (actionUrl) => this.update({ stage: 'login', actionUrl }));
          node = await this.driver.status(source, signal);
          continue;
        }
        if (node.state === 'NeedsLogin' && !node.authUrl && ++waitingWithoutLink > 24)
          throw new Error(
            'Could not reach Tailscale sign-in. Check your connection and retry. / 无法连接 Tailscale 登录服务，请检查网络后重试。',
          );
        if (node.authUrl) waitingWithoutLink = 0;
        this.update({
          stage:
            node.state === 'NeedsMachineAuth'
              ? 'approval'
              : node.state === 'NeedsLogin'
                ? 'login'
                : 'starting',
          actionUrl:
            node.state === 'NeedsMachineAuth' ? 'https://login.tailscale.com/admin/machines' : node.authUrl,
        });
      } else {
        if (!node.url)
          throw new Error(
            'Enable MagicDNS in your Tailscale network, then retry. / 请在 Tailscale 网络开启 MagicDNS 后重试。',
          );
        if (this.value.stage !== 'https')
          this.update({ stage: 'serving', actionUrl: undefined, progress: undefined });
        try {
          if (
            await this.driver.serve(source, node, port, signal, (actionUrl) =>
              this.update({ stage: 'https', actionUrl }),
            )
          ) {
            signal.throwIfAborted();
            await ready(node.url);
            this.update({ stage: 'ready', actionUrl: undefined });
            return;
          }
        } catch (error) {
          signal.throwIfAborted();
          // A system daemon may need sudo or use this port already. Give Desk its
          // own user-owned endpoint instead of changing the existing VPN.
          if (source !== 'system') throw error;
          source = 'managed';
          connected = false;
          this.update({ source, stage: 'starting', actionUrl: undefined });
          node = nodes.managed;
          if (!node) {
            await this.driver.install(signal, (state) => this.update(state));
            for (let tries = 0; tries < 12 && !node; tries++) {
              await this.driver.wait(signal);
              node = await this.driver.status(source, signal);
            }
          }
          continue;
        }
      }
      await this.driver.wait(signal);
      node = await this.driver.status(source, signal);
    }
  }
}
