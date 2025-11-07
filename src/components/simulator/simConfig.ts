import { buildStorageAlert } from '../../utils/storageAlerts';

export const DEFAULT_SIMULATION_CONTROLS = Object.freeze({
  aprFundingAlpha: 1 as number,
  aprClamp: null as number | null,
  sigmaK: 1 as number,
  ltv: { initClamp: null as number | null },
});

export type SimulationControls = typeof DEFAULT_SIMULATION_CONTROLS;

export const SIM_MODEL_CONFIG_DOM_ID = 'sim-model-config';
export const SIM_MODEL_STORAGE_KEY = 'spm_sim_model_config';

export type RawSimModelConfig = Record<string, unknown>;

export const createDefaultSimModelConfig = () => ({
  version: 1,
  updatedAt: null as string | null,
  liquidationBias: {} as Record<string, number>,
});

export type SimModelConfig = ReturnType<typeof createDefaultSimModelConfig> & RawSimModelConfig;

const clampValue = (value: unknown, min: number, max: number) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num < min) return min;
  if (num > max) return max;
  return num;
};

const sanitizeTickerList = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const list = value
    .map((item) => (typeof item === 'string' ? item.trim().toUpperCase() : ''))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  return list.length ? list : null;
};

const clone = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => clone(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>).forEach((key) => {
      out[key] = clone((value as Record<string, unknown>)[key]);
    });
    return out as T;
  }
  return value;
};

const mergeDeep = (target: Record<string, unknown>, source: unknown) => {
  if (!source || typeof source !== 'object') return target;
  Object.keys(source as Record<string, unknown>).forEach((key) => {
    const incoming = (source as Record<string, unknown>)[key];
    if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
      const baseTarget = target[key] && typeof target[key] === 'object' ? (target[key] as Record<string, unknown>) : {};
      target[key] = mergeDeep({ ...baseTarget }, incoming);
    } else {
      target[key] = clone(incoming);
    }
  });
  return target;
};

export const sanitizeSimModelConfig = (
  rawConfig: RawSimModelConfig,
  baseConfig: SimModelConfig = createDefaultSimModelConfig(),
): SimModelConfig => {
  const base = clone(baseConfig) as SimModelConfig;
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  mergeDeep(base, source);

  const cleanLoanCoins = sanitizeTickerList((base as RawSimModelConfig).loanCoins);
  if (cleanLoanCoins && cleanLoanCoins.length) {
    (base as RawSimModelConfig).loanCoins = cleanLoanCoins;
  }

  const cleanSkipAssets = sanitizeTickerList((base as RawSimModelConfig).skipAssets);
  if (cleanSkipAssets) {
    (base as RawSimModelConfig).skipAssets = cleanSkipAssets;
  }

  const cleanFunding = sanitizeTickerList((base as RawSimModelConfig).fundingSymbols);
  if (cleanFunding && cleanFunding.length) {
    (base as RawSimModelConfig).fundingSymbols = cleanFunding;
  }

  if (base.universe && typeof base.universe === 'object') {
    const universe = { ...(base.universe as Record<string, unknown>) };
    const fallbackList = sanitizeTickerList(universe.fallback);
    if (fallbackList) {
      universe.fallback = fallbackList;
    }
    const maxAssets = Number(universe.maxAssets);
    if (Number.isFinite(maxAssets) && maxAssets > 0) {
      universe.maxAssets = Math.round(maxAssets);
    } else if (universe.maxAssets != null) {
      delete universe.maxAssets;
    }
    base.universe = universe;
  }

  if (base.ltvModel && typeof base.ltvModel === 'object') {
    const model = { ...(base.ltvModel as Record<string, unknown>) };
    if (model.initMin != null) model.initMin = clampValue(model.initMin, 0, 1);
    if (model.initMax != null) model.initMax = clampValue(model.initMax, 0, 1);
    if (model.liqCap != null) model.liqCap = clampValue(model.liqCap, 0, 1);
    if (model.mcStep != null) model.mcStep = clampValue(model.mcStep, 0, 1);
    if (model.liqStep != null) model.liqStep = clampValue(model.liqStep, 0, 1);
    base.ltvModel = model;
  }

  const biasSource = (base.liquidationBias && typeof base.liquidationBias === 'object') ? base.liquidationBias : {};
  base.liquidationBias = Object.entries(biasSource as Record<string, unknown>).reduce((acc, [key, value]) => {
    const ticker = typeof key === 'string' ? key.trim().toUpperCase() : '';
    if (!ticker) return acc;
    const num = Number(value);
    if (!Number.isFinite(num)) return acc;
    acc[ticker] = clampValue(num, -0.5, 0.5);
    return acc;
  }, {} as Record<string, number>);

  const defaultVersion = createDefaultSimModelConfig().version;
  base.version = Number.isFinite(Number((base as RawSimModelConfig).version))
    ? Number((base as RawSimModelConfig).version)
    : defaultVersion;

  if (base.updatedAt != null) {
    base.updatedAt = typeof base.updatedAt === 'string'
      ? base.updatedAt
      : new Date().toISOString();
  } else {
    base.updatedAt = null;
  }

  return base;
};

export const readSimModelConfigFromDom = (onError?: (alert: ReturnType<typeof buildStorageAlert>) => void) => {
  const base = createDefaultSimModelConfig();
  if (typeof document === 'undefined') return base;
  const el = document.getElementById(SIM_MODEL_CONFIG_DOM_ID);
  if (!el) return base;
  const text = (el.textContent || el.innerText || '').trim();
  if (!text) return base;
  try {
    const parsed = JSON.parse(text) as RawSimModelConfig;
    return sanitizeSimModelConfig(parsed, base);
  } catch (err) {
    if (typeof onError === 'function') {
      onError(buildStorageAlert({
        key: 'read-sim-config-dom',
        title: 'Configuración dinámica inválida',
        message: 'No se pudo interpretar el JSON embebido para el modelo dinámico. Se usará la configuración por defecto.',
        error: err,
      }));
    } else {
      console.warn('[sim-model-config] JSON inválido, usando default', err);
    }
    return base;
  }
};

export const readSimModelConfigFromStorage = (
  onError?: (alert: ReturnType<typeof buildStorageAlert>) => void,
  baseConfig: SimModelConfig = createDefaultSimModelConfig(),
) => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SIM_MODEL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RawSimModelConfig & { version?: number };
    if (!parsed || typeof parsed !== 'object') {
      if (typeof onError === 'function') {
        onError(buildStorageAlert({
          key: 'read-sim-config-storage-format',
          title: 'Configuración dinámica inválida',
          message: 'La configuración dinámica guardada no tiene un formato válido. Se ignorará el override.',
          error: undefined,
        }));
      }
      return null;
    }
    const version = Number(parsed.version ?? 1);
    if (version !== 1) {
      if (typeof onError === 'function') {
        onError(buildStorageAlert({
          key: `read-sim-config-storage-version-${version}`,
          title: 'Configuración desactualizada',
          message: `La configuración dinámica guardada usa la versión ${parsed.version}, no compatible con esta build.`,
          error: undefined,
        }));
      }
      return null;
    }
    return sanitizeSimModelConfig(parsed, baseConfig);
  } catch (err) {
    if (typeof onError === 'function') {
      onError(buildStorageAlert({
        key: 'read-sim-config-storage',
        title: 'Sin acceso a configuración guardada',
        message: 'No se pudo leer la configuración dinámica personalizada desde el navegador. Se usará el preset base.',
        error: err,
      }));
    }
    return null;
  }
};

export const readSimModelConfig = (onError?: (alert: ReturnType<typeof buildStorageAlert>) => void) => {
  const base = readSimModelConfigFromDom(onError);
  const override = readSimModelConfigFromStorage(onError, base);
  if (override) {
    if (!override.updatedAt) {
      override.updatedAt = new Date().toISOString();
    }
    return override;
  }
  return base;
};

const ensureSimModelConfigElement = () => {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(SIM_MODEL_CONFIG_DOM_ID) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/json';
    el.id = SIM_MODEL_CONFIG_DOM_ID;
    el.textContent = JSON.stringify(createDefaultSimModelConfig(), null, 2);
    (document.body || document.head || document.documentElement).appendChild(el);
  }
  return el;
};

export const writeSimModelConfigToDom = (config: SimModelConfig) => {
  if (typeof document === 'undefined') return;
  const el = ensureSimModelConfigElement();
  if (!el) return;
  try {
    el.textContent = JSON.stringify(config, null, 2);
  } catch (err) {
    console.warn('[sim-model-config] no se pudo escribir en el DOM', err);
  }
};

export const writeSimModelConfigToStorage = (
  config: SimModelConfig,
  onError?: (alert: ReturnType<typeof buildStorageAlert>) => void,
) => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(SIM_MODEL_STORAGE_KEY, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    if (typeof onError === 'function') {
      onError(buildStorageAlert({
        key: 'write-sim-config-storage',
        title: 'No se pudo guardar la configuración',
        message: 'El navegador bloqueó el guardado de la configuración dinámica. Los cambios solo se aplicarán en esta sesión.',
        error: err,
      }));
    }
    return false;
  }
};

export const clearSimModelConfigStorage = (
  onError?: (alert: ReturnType<typeof buildStorageAlert>) => void,
) => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.removeItem(SIM_MODEL_STORAGE_KEY);
    return true;
  } catch (err) {
    if (typeof onError === 'function') {
      onError(buildStorageAlert({
        key: 'clear-sim-config-storage',
        title: 'No se pudo limpiar la configuración',
        message: 'El navegador bloqueó la eliminación de la configuración dinámica guardada. Probá borrar el almacenamiento manualmente.',
        error: err,
      }));
    }
    return false;
  }
};
