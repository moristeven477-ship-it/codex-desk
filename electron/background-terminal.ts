import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findCodex } from './codex';
import type { TerminalCommand } from './terminal';

export class BackgroundTerminal {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, Promise<{ reused: boolean }>>();
  constructor(private directory: string) {}

  prepare(threadId: string, title: string, command: TerminalCommand) {
    const key = command.codexHome + ':' + threadId;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        const { env } = await findCodex(command.binary);
        const script = readFileSync(
          path.join(
            typeof __dirname === 'string' ? __dirname : path.resolve('electron'),
            'background-terminal.py',
          ),
          'utf8',
        );
        return new Promise<{ reused: boolean }>((resolve, reject) => {
          const child = spawn('/usr/bin/python3', ['-c', script], { env, stdio: ['pipe', 'pipe', 'pipe'] });
          let output = '',
            error = '';
          const timer = setTimeout(() => child.kill(), 20_000);
          child.stdout.on('data', (chunk: Buffer) => {
            output += chunk.toString();
          });
          child.stderr.on('data', (chunk: Buffer) => {
            error += chunk.toString();
          });
          child.once('error', (reason) => {
            clearTimeout(timer);
            reject(reason);
          });
          child.once('exit', (code) => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(error.trim() || 'Could not prepare Ubuntu Terminal.'));
            try {
              resolve(JSON.parse(output));
            } catch {
              reject(new Error('Invalid terminal response.'));
            }
          });
          child.stdin.on('error', () => {});
          const focusLibrary = path.join(
            typeof __dirname === 'string'
              ? __dirname.replace(/app\.asar(?=\/)/, 'app.asar.unpacked')
              : path.resolve('dist-electron'),
            'background-window.so',
          );
          child.stdin.end(
            JSON.stringify({ ...command, directory: this.directory, threadId, title, env, focusLibrary }),
          );
        });
      });
    this.queue = operation;
    this.pending.set(key, operation);
    void operation
      .finally(() => {
        if (this.pending.get(key) === operation) this.pending.delete(key);
      })
      .catch(() => {});
    return operation;
  }
}
