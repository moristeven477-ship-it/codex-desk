import { nativeImage } from 'electron';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { MAX_IMAGES, MAX_IMAGE_BYTES } from '../src/shared/images';
import type { ImageAttachment } from '../src/shared/types';

type Translate = (zh: string, en: string) => string;

/** Persist clipboard bytes, never renderer-supplied paths, for Codex localImage input. */
export async function importImages(
  directory: string,
  uploads: unknown,
  t: Translate,
): Promise<ImageAttachment[]> {
  if (!Array.isArray(uploads) || !uploads.length || uploads.length > MAX_IMAGES)
    throw new Error(t('每次最多添加 8 张图片。', 'Attach up to 8 images at a time.'));
  // Validate the whole batch before decoding or writing anything.
  for (const upload of uploads) {
    if (
      !upload ||
      typeof upload.name !== 'string' ||
      upload.name.length > 255 ||
      !(upload.bytes instanceof Uint8Array) ||
      !upload.bytes.byteLength
    )
      throw new Error(t('无法读取剪贴板图片。', 'Could not read the clipboard image.'));
    if (upload.bytes.byteLength > MAX_IMAGE_BYTES)
      throw new Error(t('每张图片不能超过 20 MiB。', 'Each image must be 20 MiB or smaller.'));
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const created: string[] = [];
  const images: ImageAttachment[] = [];
  try {
    for (const upload of uploads) {
      const image = nativeImage.createFromBuffer(Buffer.from(upload.bytes));
      if (image.isEmpty()) throw new Error(t('无法读取此图片格式。', 'This image format could not be read.'));
      // Normalize the actual raster; do not trust MIME types or filename extensions.
      const png = image.toPNG();
      if (!png.length || png.length > MAX_IMAGE_BYTES)
        throw new Error(t('每张图片不能超过 20 MiB。', 'Each image must be 20 MiB or smaller.'));
      const file = path.join(directory, `clipboard-${randomUUID()}.png`);
      await writeFile(file, png, { flag: 'wx', mode: 0o600 });
      created.push(file);
      images.push({
        path: file,
        name: path.basename(upload.name).replace(/[\x00-\x1f\x7f]/g, '') || 'clipboard.png',
        preview: image.resize({ width: 120 }).toDataURL(),
      });
    }
    return images;
  } catch (error) {
    // Remove only this failed import; previous conversation attachments must remain readable.
    await Promise.allSettled(created.map((file) => unlink(file)));
    throw error;
  }
}
