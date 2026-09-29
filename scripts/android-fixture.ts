// Isolated gateway used by the embedded Android transport test. No real CLI.
import { remoteFixture } from '../tests/fixtures/remote';
const fixture = await remoteFixture();
await fixture.gateway.setOrigin('https://desk.tailtest.ts.net:8443');
console.log(
  'ANDROID_FIXTURE=' +
    JSON.stringify({
      gateway: fixture.gateway.status.localOrigin,
      code: fixture.gateway.createPairing().code,
    }),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await fixture.close();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
process.stdin.resume();
process.stdin.on('end', close);
