import { DEFAULT_FONT_SIZE } from '../shared/appearance';

export function applyFontSize(value: number) {
  document.documentElement.style.fontSize = `${(16 * value) / DEFAULT_FONT_SIZE}px`;
}
