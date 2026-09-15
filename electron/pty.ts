import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CodexEvent } from '../src/shared/types';
import type { TerminalCommand } from './terminal';
import { findCodex } from './codex';

export class CodexTerminal {
  private sessions = new Map<string, ChildProcessWithoutNullStreams>();
  constructor(private emit: (event: CodexEvent) => void) {}
  async start(command: TerminalCommand, cols: number, rows: number) {
    if (this.sessions.size >= 4) throw new Error('Close an existing terminal before opening another.');
    const id = randomUUID();
    const { env } = await findCodex(command.binary);
    // The script is copied beside the main bundle. Source tests use the repository file.
    const script = readFileSync(
      path.join(typeof __dirname === 'string' ? __dirname : path.resolve('electron'), 'pty-bridge.py'),
      'utf8',
    );
    const child = spawn(
      '/usr/bin/python3',
      ['-u', '-c', script, String(cols), String(rows), command.binary, ...command.args],
      {
        cwd: command.cwd,
        env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', CODEX_HOME: command.codexHome },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.sessions.set(id, child);
    const lines = createInterface({ input: child.stdout });
    let exited = false;
    const exit = (exitCode: number) => {
      if (exited) return;
      exited = true;
      this.sessions.delete(id);
      this.emit({ kind: 'terminal', terminalId: id, exitCode });
    };
    lines.on('line', (line) => {
      try {
        const frame = JSON.parse(line);
        if (typeof frame.data === 'string') this.emit({ kind: 'terminal', terminalId: id, data: frame.data });
        if (typeof frame.exitCode === 'number') exit(frame.exitCode);
      } catch {
        /* Only the local bridge writes this pipe. */
      }
    });
    child.stderr.on('data', (data: Buffer) =>
      this.emit({ kind: 'terminal', terminalId: id, data: data.toString() }),
    );
    child.on('error', (error) => {
      this.emit({ kind: 'terminal', terminalId: id, data: error.message });
      exit(1);
    });
    child.on('exit', (code) => {
      lines.close();
      exit(code ?? 0);
    });
    child.stdin.on('error', () => {}); // A TUI may exit while an input message is in flight.
    return { id };
  }
  send(id: string, message: unknown) {
    const child = this.sessions.get(id);
    if (!child || child.stdin.destroyed) throw new Error('This terminal has closed.');
    child.stdin.write(JSON.stringify(message) + '\n');
  }
  stop(id: string) {
    this.sessions.get(id)?.stdin.end();
  }
  close() {
    for (const child of this.sessions.values()) child.stdin.end();
  }
}
