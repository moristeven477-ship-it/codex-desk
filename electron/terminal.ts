import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { findCodex } from './codex';

export interface TerminalCommand {
  binary: string;
  args: string[];
  cwd: string;
  codexHome: string;
  command: string;
}

export async function openTerminal(command: TerminalCommand) {
  const { env } = await findCodex(command.binary);
  const candidates = [
    {
      binary: '/usr/bin/gnome-terminal',
      args: ['--working-directory', command.cwd, '--', command.binary, ...command.args],
    },
    { binary: '/usr/bin/x-terminal-emulator', args: ['-e', command.binary, ...command.args] },
  ];
  for (const terminal of candidates) {
    try {
      await access(terminal.binary, constants.X_OK);
    } catch {
      continue;
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(terminal.binary, terminal.args, {
        cwd: command.cwd,
        env: { ...env, CODEX_HOME: command.codexHome },
        stdio: 'ignore',
        detached: true,
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
    return;
  }
  throw new Error('No terminal application was found. Copy the command and run it in your terminal.');
}
