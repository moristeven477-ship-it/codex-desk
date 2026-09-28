#!/usr/bin/env node
// Native desktop setup fixture: no daemon, network, or account is touched.
import { readFileSync, writeFileSync } from 'node:fs';
if (!process.argv.some((arg) => arg.startsWith('--socket='))) process.exit(1);
const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--socket='));
const file = process.env.CODEX_DESK_TAILSCALE_FIXTURE;
if (!file) process.exit(2);
const state = JSON.parse(readFileSync(file, 'utf8'));
if (args[0] === 'status') {
  console.log(
    JSON.stringify({
      BackendState: state.loggedIn ? 'Running' : 'NeedsLogin',
      AuthURL: state.loggedIn ? '' : 'https://login.tailscale.com/a/synthetic-native',
      Self: { DNSName: state.loggedIn ? 'desk.tailtest.ts.net.' : '' },
    }),
  );
} else if (args[0] === 'up') {
  console.log('To authenticate: https://login.tailscale.com/a/synthetic-native');
  process.exitCode = 1;
} else if (args[0] === 'serve' && args[1] === 'status') {
  console.log(JSON.stringify(state.route ?? {}));
} else if (args[0] === 'serve' && !state.https) {
  console.log('Enable HTTPS: https://login.tailscale.com/f/serve?node=synthetic-native');
} else if (args[0] === 'serve' && state.https) {
  state.route = {
    TCP: { 8443: { HTTPS: true } },
    Web: { 'desk.tailtest.ts.net:8443': { Handlers: { '/': { Proxy: args.at(-1) } } } },
  };
  writeFileSync(file, JSON.stringify(state));
} else process.exitCode = 2;
