import { PLATFORM_PRESETS_V1 } from './v1';

export const PLATFORM_PRESET_VERSIONS = {
  v1: PLATFORM_PRESETS_V1,
} as const;

export type PlatformPresetVersion = keyof typeof PLATFORM_PRESET_VERSIONS;
export type PlatformPresetMap = typeof PLATFORM_PRESETS_V1;

export const DEFAULT_PLATFORM_PRESET_VERSION: PlatformPresetVersion = 'v1';

export const getPlatformPresets = (version: PlatformPresetVersion = DEFAULT_PLATFORM_PRESET_VERSION) => {
  return PLATFORM_PRESET_VERSIONS[version];
};

export const PLATFORM_BASE_CONFIGS = getPlatformPresets();

export const PLATFORM_IDS = Object.keys(PLATFORM_BASE_CONFIGS);

export const BASE_GLOBAL_COINGECKO_IDS = Object.values(PLATFORM_BASE_CONFIGS).reduce(
  (acc, cfg) => ({
    ...acc,
    ...(cfg.coingeckoIds || {}),
  }),
  {} as Record<string, string>,
);

export const listPlatformPresetVersions = () => Object.keys(PLATFORM_PRESET_VERSIONS) as PlatformPresetVersion[];
