import { mkdir, readFile, writeFile, chmod, access, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('Set ANDROID_HOME to your Android SDK.');
if (process.env.JAVA_HOME)
  process.env.PATH = path.join(process.env.JAVA_HOME, 'bin') + path.delimiter + (process.env.PATH || '');
const signing =
  process.env.ANDROID_SIGNING_DIR || path.join(homedir(), '.local/share/codex-desk/android-signing');
await mkdir(signing, { recursive: true, mode: 0o700 });
await chmod(signing, 0o700);
const key = path.join(signing, 'release.p12');
const password = path.join(signing, 'password');
const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/keytool') : 'keytool';
try {
  await access(key);
} catch {
  await writeFile(password, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
  execFileSync(
    keytool,
    [
      '-genkeypair',
      '-keystore',
      key,
      '-storetype',
      'PKCS12',
      '-storepass:file',
      password,
      '-keypass:file',
      password,
      '-alias',
      'codex-desk',
      '-keyalg',
      'RSA',
      '-keysize',
      '4096',
      '-validity',
      '10000',
      '-dname',
      'CN=Codex Desk, O=Codex Desk contributors',
      '-noprompt',
    ],
    { stdio: 'inherit' },
  );
  await chmod(key, 0o600);
}
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('release', { recursive: true });
const output = path.resolve(`release/codex-desk-${version}-android.apk`);
const unsigned = path.resolve('android/app/build/outputs/apk/release/app-release-unsigned.apk');
const tools = path.join(sdk, 'build-tools/35.0.0');
execFileSync(path.join(tools, 'zipalign'), ['-f', '4', unsigned, output], { stdio: 'inherit' });
execFileSync(
  path.join(tools, 'apksigner'),
  ['sign', '--ks', key, '--ks-key-alias', 'codex-desk', '--ks-pass', `file:${password}`, output],
  { stdio: 'inherit' },
);
execFileSync(path.join(tools, 'apksigner'), ['verify', '--verbose', '--print-certs', output], {
  stdio: 'inherit',
});
execFileSync(keytool, [
  '-exportcert',
  '-rfc',
  '-keystore',
  key,
  '-storepass:file',
  password,
  '-alias',
  'codex-desk',
  '-file',
  path.join(signing, 'release-cert.pem'),
]);
await copyFile(path.join(signing, 'release-cert.pem'), 'android/release-cert.pem');
console.log(`Signed ${output}. Keep the private signing directory backed up for future updates.`);
