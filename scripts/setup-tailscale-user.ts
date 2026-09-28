import { createTailscaleDriver } from '../electron/tailscale';
const driver = createTailscaleDriver();
const signal = new AbortController().signal;
await driver.install(signal, (state) => {
  if (state.stage) console.log(state.stage);
});
await driver.connect(signal, (url) => console.log('Sign in to Tailscale:', url));
console.log('Continue in Codex Desk → Settings → Phone access.');
