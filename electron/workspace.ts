import { realpath, stat, readdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { FileEntry, FilePreview, GitFile, GitStatus } from '../src/shared/types';

const exec = promisify(execFile);
const hiddenDirectories = new Set([
  '.git',
  'node_modules',
  '.next',
  '.cache',
  'target',
  'dist',
  'dist-electron',
  'release',
]);
export async function directoryPath(input: string) {
  if (!path.isAbsolute(input)) throw new Error('Choose an absolute directory path.');
  const resolved = await realpath(input);
  if (!(await stat(resolved)).isDirectory()) throw new Error('The selected path is not a directory.');
  return resolved;
}
export function isInside(root: string, target: string) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
export async function safePath(root: string, relativePath = '') {
  const canonicalRoot = await realpath(root);
  const candidate = path.resolve(canonicalRoot, relativePath);
  if (!isInside(canonicalRoot, candidate)) throw new Error('The path is outside the selected project.');
  const canonical = await realpath(candidate);
  if (!isInside(canonicalRoot, canonical))
    throw new Error('This symbolic link points outside the selected project.');
  return canonical;
}
export async function listFiles(
  root: string,
  relativePath = '',
): Promise<{ entries: FileEntry[]; truncated: boolean }> {
  const folder = await safePath(root, relativePath);
  const entries = (await readdir(folder, { withFileTypes: true }))
    .filter((e) => !hiddenDirectories.has(e.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  return {
    entries: entries.slice(0, 500).map((e) => ({
      name: e.name,
      path: path.relative(root, path.join(folder, e.name)),
      directory: e.isDirectory(),
      symlink: e.isSymbolicLink(),
    })),
    truncated: entries.length > 500,
  };
}
export async function previewFile(root: string, relativePath: string): Promise<FilePreview> {
  const file = await safePath(root, relativePath);
  const metadata = await stat(file);
  if (!metadata.isFile()) throw new Error('Choose a regular file.');
  if (metadata.size > 1024 * 1024) throw new Error('Preview is limited to files up to 1 MiB.');
  const content = await readFile(file);
  if (content.subarray(0, 8000).includes(0))
    throw new Error('This is a binary file; text preview is unavailable.');
  return {
    path: relativePath,
    content: content.toString('utf8'),
    language: path.extname(file).slice(1) || 'text',
  };
}
async function git(root: string, args: string[]) {
  return (
    await exec(
      'git',
      [
        '--literal-pathspecs',
        '-C',
        root,
        '-c',
        'core.quotepath=false',
        '-c',
        'core.fsmonitor=false',
        ...args,
      ],
      {
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      },
    )
  ).stdout;
}
export function parseStatus(output: string): GitFile[] {
  const fields = output.split('\0');
  const result: GitFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.length < 4) continue;
    const file: GitFile = { index: field[0], working: field[1], path: field.slice(3) };
    if (/[RC]/.test(field.slice(0, 2))) file.oldPath = fields[++i];
    result.push(file);
  }
  return result;
}
export async function gitStatus(root: string): Promise<GitStatus> {
  try {
    await git(root, ['rev-parse', '--is-inside-work-tree']);
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ENOENT')
      throw new Error('Git is not installed or not in PATH.');
    return { isRepo: false, branch: '', files: [], added: 0, removed: 0 };
  }
  const [status, prefix, branch, unstaged, staged] = await Promise.all([
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']),
    git(root, ['rev-parse', '--show-prefix']),
    git(root, ['symbolic-ref', '--short', 'HEAD']).catch(() => git(root, ['rev-parse', '--short', 'HEAD'])),
    git(root, ['diff', '--relative', '--no-ext-diff', '--no-textconv', '--numstat', '--', '.']),
    git(root, ['diff', '--cached', '--relative', '--no-ext-diff', '--no-textconv', '--numstat', '--', '.']),
  ]);
  let added = 0,
    removed = 0;
  for (const line of (unstaged + '\n' + staged).split('\n')) {
    const fields = line.split('\t');
    added += Number(fields[0]) || 0;
    removed += Number(fields[1]) || 0;
  }
  // Porcelain v1 paths are repository-relative, even when the selected project is a subdirectory.
  const directoryPrefix = prefix.replace(/\n$/, '');
  const files = parseStatus(status)
    .filter((file) => file.path.startsWith(directoryPrefix))
    .map((file) => ({
      ...file,
      path: file.path.slice(directoryPrefix.length),
      oldPath: file.oldPath?.startsWith(directoryPrefix)
        ? file.oldPath.slice(directoryPrefix.length)
        : file.oldPath,
    }));
  return { isRepo: true, branch: branch.trim(), files, added, removed };
}
export async function gitDiff(root: string, relativePath: string) {
  // Deleted files cannot be realpath'd; validate their parent and lexical location.
  const candidate = path.resolve(root, relativePath);
  if (!relativePath || !isInside(root, candidate)) throw new Error('Invalid project file path.');
  let parent = path.dirname(candidate);
  while (isInside(root, parent)) {
    try {
      await safePath(root, path.relative(root, parent));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (parent === root) break;
    parent = path.dirname(parent);
  }
  const [unstaged, staged] = await Promise.all([
    git(root, ['diff', '--relative', '--no-ext-diff', '--no-textconv', '--', relativePath]),
    git(root, ['diff', '--cached', '--relative', '--no-ext-diff', '--no-textconv', '--', relativePath]),
  ]);
  if (staged || unstaged)
    return {
      content: [staged && '# Staged\n' + staged, unstaged && '# Working tree\n' + unstaged]
        .filter(Boolean)
        .join('\n'),
    };
  const metadata = await gitStatus(root);
  if (metadata.files.some((f) => f.path === relativePath && f.index === '?')) {
    const preview = await previewFile(root, relativePath);
    const lines = preview.content.split('\n');
    return {
      content:
        `--- /dev/null\n+++ b/${relativePath}\n@@ -0,0 +1,${lines.length} @@\n` +
        lines.map((l) => '+' + l).join('\n'),
    };
  }
  return { content: '' };
}
