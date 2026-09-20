import type { Model } from './types';

export function isFastTier(tier?: string | null) {
  return tier === 'priority' || tier === 'fast';
}

export function fastTier(model?: Model): string | undefined {
  // Use the installed CLI's catalog, including the older speed-tier field.
  if (model?.serviceTiers !== undefined) return model.serviceTiers.find((tier) => isFastTier(tier.id))?.id;
  return model?.additionalSpeedTiers?.includes('fast') ? 'fast' : undefined;
}
