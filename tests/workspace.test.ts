import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { gitStatus, gitDiff, listFiles, previewFile, safePath } from '../electron/workspace';
const exec = promisify(execFile);
test('file inspection stays inside the selected root including symbolic links', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-files-'));
  try {
    const project = path.join(root, 'project');
    await mkdir(project);
    await mkdir(path.join(project, 'node_modules'));
    await writeFile(path.join(project, 'hello.ts'), 'export const hello = 1;');
    await writeFile(path.join(root, 'private.txt'), 'outside');
    await symlink(path.join(root, 'private.txt'), path.join(project, 'escape.txt'));
    await assert.rejects(safePath(project, '../private.txt'), /outside/);
    await assert.rejects(previewFile(project, 'escape.txt'), /symbolic link/);
    await writeFile(path.join(project, 'image.bin'), Buffer.from([1, 0, 2]));
    await assert.rejects(previewFile(project, 'image.bin'), /binary/);
    await writeFile(path.join(project, 'large.txt'), Buffer.alloc(1024 * 1024 + 1, 65));
    await assert.rejects(previewFile(project, 'large.txt'), /1 MiB/);
    assert.equal((await previewFile(project, 'hello.ts')).content, 'export const hello = 1;');
    assert.ok(!(await listFiles(project)).entries.some((e) => e.name === 'node_modules'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('Git inspector handles staged, unstaged, untracked and renamed paths with spaces', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-git-'));
  const git = (...args: string[]) => exec('git', ['-C', root, ...args]);
  try {
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'Test');
    await git('config', 'user.email', 'test@example.com');
    await writeFile(path.join(root, 'original name.txt'), 'first\n');
    await git('add', '.');
    await git('commit', '-m', 'Initial');
    await rename(path.join(root, 'original name.txt'), path.join(root, 'new name.txt'));
    await git('add', '.');
    await writeFile(path.join(root, 'new name.txt'), 'first\nsecond\n');
    await writeFile(path.join(root, 'untracked.txt'), 'hello\n');
    const status = await gitStatus(root);
    assert.equal(status.branch, 'main');
    assert.equal(status.files.length, 2);
    assert.ok(status.files.some((f) => f.path === 'new name.txt' && f.oldPath === 'original name.txt'));
    assert.match((await gitDiff(root, 'new name.txt')).content, /\+second/);
    assert.match((await gitDiff(root, 'untracked.txt')).content, /\+hello/);
    await assert.rejects(gitDiff(root, '../outside'), /Invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a project inside a Git repository scopes paths, counts and literal filenames correctly', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-git-subdirectory-'));
  const git = (...args: string[]) => exec('git', ['-C', root, ...args]);
  try {
    const project = path.join(root, 'packages', 'web app');
    await mkdir(project, { recursive: true });
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'Test');
    await git('config', 'user.email', 'test@example.com');
    await writeFile(path.join(root, 'outside.txt'), 'first\n');
    await writeFile(path.join(project, '[route].txt'), 'first\n');
    await git('add', '.');
    await git('commit', '-m', 'Initial');
    await writeFile(path.join(root, 'outside.txt'), 'outside\n');
    await writeFile(path.join(project, '[route].txt'), 'first\ninside\n');
    await mkdir(path.join(project, 'new'));
    await writeFile(path.join(project, 'new', 'file.txt'), 'new file\n');
    const status = await gitStatus(project);
    assert.deepEqual(status.files.map((file) => file.path).sort(), ['[route].txt', 'new/file.txt']);
    assert.equal(status.added, 1);
    assert.equal(status.removed, 0);
    assert.match((await gitDiff(project, '[route].txt')).content, /\+inside/);
    assert.match((await gitDiff(project, 'new/file.txt')).content, /\+new file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
