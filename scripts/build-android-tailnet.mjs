import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleDir = join(root, 'android/tailnet');
const output = join(root, 'android/app/build/tailnet');
const bin = join(root, 'android/build/go/bin');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('Set ANDROID_HOME to the Android SDK directory.');
const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  ANDROID_NDK_HOME: join(sdk, 'ndk/29.0.14206865'),
  GOBIN: bin,
  GOMAXPROCS: process.env.GOMAXPROCS || '4',
  GOFLAGS: `${process.env.GOFLAGS || ''} -p=4`.trim(),
  PATH: [bin, ...(process.env.JAVA_HOME ? [join(process.env.JAVA_HOME, 'bin')] : []), process.env.PATH].join(
    delimiter,
  ),
};
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: moduleDir,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return result.stdout;
}
mkdirSync(bin, { recursive: true });
mkdirSync(join(output, 'assets'), { recursive: true });
run('go', ['install', 'golang.org/x/mobile/cmd/gomobile', 'golang.org/x/mobile/cmd/gobind']);
run(join(bin, 'gomobile'), [
  'bind',
  '-target',
  'android/arm64,android/arm,android/amd64',
  '-androidapi',
  '26',
  '-trimpath',
  '-ldflags',
  '-s -w -linkmode=external -extldflags=-Wl,-z,max-page-size=16384',
  '-o',
  join(output, 'tailnet.aar'),
  '.',
]);

// Ship upstream license texts with the APK, including indirect dependencies.
const notices = [
  `Codex Desk Android · embedded Tailscale\nhttps://github.com/moristeven477-ship-it/codex-desk\n${readFileSync(join(root, 'LICENSE'), 'utf8')}`,
];
const modules = run('go', ['list', '-m', '-f', '{{.Path}}\t{{.Version}}\t{{.Dir}}', 'all'], true);
for (const line of modules.trim().split('\n')) {
  const [name, version, directory] = line.split('\t');
  if (!directory) continue;
  const files = readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /^(licen[cs]e|copying|notice|copyright|patents)([._-]|$)/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  for (const file of files)
    notices.push(`${name} ${version || ''} · ${file}\n${readFileSync(join(directory, file), 'utf8')}`);
}
const goroot = run('go', ['env', 'GOROOT'], true).trim();
notices.push(`Go runtime\n${readFileSync(join(goroot, 'LICENSE'), 'utf8')}`);
notices.push(
  `AndroidX WebKit and AndroidX libraries · Copyright The Android Open Source Project\nhttps://cs.android.com/androidx/platform/frameworks/support\n${readFileSync(join(root, 'android/ANDROIDX_LICENSE.txt'), 'utf8')}`,
);
writeFileSync(join(output, 'assets/TAILNET_NOTICES.txt'), notices.join('\n\n' + '='.repeat(72) + '\n\n'));
