import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppState } from '../src/shared/types';
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE } from '../src/shared/appearance';

export const settingsSchema = z.object({
  binaryPath: z.string().max(4096).default(''),
  codexHome: z.string().max(4096).default(''),
  defaultWorkspace: z.string().max(4096).default(''),
  locale: z.enum(['zh', 'en']).default('zh'),
  theme: z.enum(['dark', 'light']).default('dark'),
  fontSize: z.number().int().min(MIN_FONT_SIZE).max(MAX_FONT_SIZE).default(DEFAULT_FONT_SIZE),
  lastProjectId: z.string().default(''),
  lastThreadId: z.string().default(''),
});
export const settingsPatchSchema = z
  .object({
    binaryPath: settingsSchema.shape.binaryPath.removeDefault(),
    codexHome: settingsSchema.shape.codexHome.removeDefault(),
    defaultWorkspace: settingsSchema.shape.defaultWorkspace.removeDefault(),
    locale: settingsSchema.shape.locale.removeDefault(),
    theme: settingsSchema.shape.theme.removeDefault(),
    fontSize: settingsSchema.shape.fontSize.removeDefault(),
    lastProjectId: settingsSchema.shape.lastProjectId.removeDefault(),
    lastThreadId: settingsSchema.shape.lastThreadId.removeDefault(),
  })
  .partial();
const schema = z.object({
  settings: settingsSchema.default({
    binaryPath: '',
    codexHome: '',
    defaultWorkspace: '',
    locale: 'zh',
    theme: 'dark',
    fontSize: DEFAULT_FONT_SIZE,
    lastProjectId: '',
    lastThreadId: '',
  }),
  projects: z
    .array(z.object({ id: z.string(), name: z.string(), path: z.string(), createdAt: z.number() }))
    .default([]),
});

export class Store {
  state: AppState = schema.parse({});
  private saving: Promise<void> = Promise.resolve();
  constructor(private directory: string) {}
  async load() {
    try {
      this.state = schema.parse(JSON.parse(await readFile(path.join(this.directory, 'state.json'), 'utf8')));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Preserve a corrupt file for recovery; never discard it silently.
        await rename(
          path.join(this.directory, 'state.json'),
          path.join(this.directory, `state.corrupt-${Date.now()}.json`),
        ).catch(() => {});
      }
    }
    return this.state;
  }
  async save() {
    const data = JSON.stringify(schema.parse(this.state), null, 2);
    const operation = this.saving
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const target = path.join(this.directory, 'state.json');
        await writeFile(target + '.tmp', data, { mode: 0o600 });
        await rename(target + '.tmp', target);
      });
    this.saving = operation;
    return operation;
  }
}
