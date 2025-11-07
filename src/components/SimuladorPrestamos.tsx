import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_EXCHANGE_RATES, LIVE_REFRESH_SECONDS } from '../data/sharedDefaults';
import { BASE_GLOBAL_COINGECKO_IDS, PLATFORM_BASE_CONFIGS, PLATFORM_IDS } from '../data/platformPresets';
import { buildStorageAlert } from '../utils/storageAlerts';
import {
  DEFAULT_SIMULATION_CONTROLS,
  clearSimModelConfigStorage,
  createDefaultSimModelConfig,
  readSimModelConfig,
  readSimModelConfigFromDom,
  sanitizeSimModelConfig,
  writeSimModelConfigToDom,
  writeSimModelConfigToStorage,
} from './simulator/simConfig';
import { DEFAULT_THEME, THEME_TOKENS, applyTheme, initializeTheme } from './simulator/themes';
import { useStorageAlerts } from './simulator/hooks/useStorageAlerts';

initializeTheme();

const PLATFORM_STORAGE_KEY = 'spm_platform';
const STATE_STORAGE_PREFIX = 'spm_state_';

const DEFAULT_LOCALE = 'es-AR';

type PlatformId = (typeof PLATFORM_IDS)[number];

type AssetState = {
  id: number;
  name: string;
  ticker: string;
  qty: number;
  price: number;
  priceAuto: boolean;
  useAsCollateral: boolean;
};

type SimulationParams = {
  exchangeRates: Record<string, number>;
  loyaltyModel: string;
  liveQuotes: boolean;
  earnOptIn: boolean;
  earnOnCollateral: boolean;
  refreshSec: number;
  controls?: typeof DEFAULT_SIMULATION_CONTROLS;
};

type SimulationSnapshot = {
  loanAmount: number;
  repayInDays: number;
  currency: string;
  assets: AssetState[];
  params: SimulationParams;
};

const formatCurrency = (value: number, currency: string) => {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${formatNumber(value, 2)}`;
  }
};

const formatNumber = (value: number, digits = 2) => {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
};

const formatPercent = (value: number, digits = 2) => {
  if (!Number.isFinite(value)) return '—';
  return `${formatNumber(value * 100, digits)}%`;
};

const loadPlatformSnapshot = (platformId: PlatformId): SimulationSnapshot => {
  const preset = PLATFORM_BASE_CONFIGS[platformId];
  const preview = preset.previewSnapshot;
  const params: SimulationParams = preview?.params
    ? {
        exchangeRates: { ...DEFAULT_EXCHANGE_RATES, ...preview.params.exchangeRates },
        loyaltyModel: preview.params.loyaltyModel ?? preset.defaultParams.loyaltyModel ?? 'vsRest',
        liveQuotes: preview.params.liveQuotes ?? true,
        earnOptIn: preview.params.earnOptIn ?? true,
        earnOnCollateral: preview.params.earnOnCollateral ?? true,
        refreshSec: preview.params.refreshSec ?? LIVE_REFRESH_SECONDS,
        controls: DEFAULT_SIMULATION_CONTROLS,
      }
    : {
        exchangeRates: { ...DEFAULT_EXCHANGE_RATES, ...preset.defaultParams.exchangeRates },
        loyaltyModel: preset.defaultParams.loyaltyModel ?? 'vsRest',
        liveQuotes: preset.defaultParams.liveQuotes ?? true,
        earnOptIn: preset.defaultParams.earnOptIn ?? true,
        earnOnCollateral: preset.defaultParams.earnOnCollateral ?? true,
        refreshSec: preset.defaultParams.refreshSec ?? LIVE_REFRESH_SECONDS,
        controls: DEFAULT_SIMULATION_CONTROLS,
      };
  const baseAssets = preview?.assets ?? preset.defaultAssets ?? [];
  const assets = baseAssets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    ticker: asset.ticker,
    qty: Number(asset.qty) || 0,
    price: Number(asset.price) || 0,
    priceAuto: !!asset.priceAuto,
    useAsCollateral: asset.useAsCollateral ?? true,
  }));
  return {
    loanAmount: preview?.loanAmount ?? 0,
    repayInDays: preview?.repayInDays ?? 90,
    currency: preview?.currency ?? 'USDT',
    assets,
    params,
  };
};

const readStoredPlatform = (
  registerInitialStorageAlert: (alert: ReturnType<typeof buildStorageAlert>) => void,
  fallback: PlatformId,
): PlatformId => {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem(PLATFORM_STORAGE_KEY);
    return PLATFORM_IDS.includes(stored as PlatformId) ? (stored as PlatformId) : fallback;
  } catch (error) {
    registerInitialStorageAlert(
      buildStorageAlert({
        key: 'read-platform',
        message: 'No se pudo leer la plataforma guardada. Se usará la plataforma por defecto.',
        error,
      }),
    );
    return fallback;
  }
};

const loadStoredSimulation = (
  platformId: PlatformId,
  registerInitialStorageAlert: (alert: ReturnType<typeof buildStorageAlert>) => void,
): SimulationSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${STATE_STORAGE_PREFIX}${platformId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const snapshot = parsed as Partial<SimulationSnapshot>;
    if (!Array.isArray(snapshot.assets)) return null;
    return {
      loanAmount: Number(snapshot.loanAmount) || 0,
      repayInDays: Number(snapshot.repayInDays) || 90,
      currency: typeof snapshot.currency === 'string' ? snapshot.currency : 'USDT',
      assets: snapshot.assets.map((asset, index) => ({
        id: typeof asset.id === 'number' ? asset.id : index + 1,
        name: typeof asset.name === 'string' ? asset.name : `Asset ${index + 1}`,
        ticker: typeof asset.ticker === 'string' ? asset.ticker : '',
        qty: Number(asset.qty) || 0,
        price: Number(asset.price) || 0,
        priceAuto: !!asset.priceAuto,
        useAsCollateral: asset.useAsCollateral ?? true,
      })),
      params: {
        exchangeRates: {
          ...DEFAULT_EXCHANGE_RATES,
          ...((snapshot.params?.exchangeRates as Record<string, number>) ?? {}),
        },
        loyaltyModel:
          typeof snapshot.params?.loyaltyModel === 'string'
            ? snapshot.params.loyaltyModel
            : 'vsRest',
        liveQuotes: snapshot.params?.liveQuotes ?? true,
        earnOptIn: snapshot.params?.earnOptIn ?? true,
        earnOnCollateral: snapshot.params?.earnOnCollateral ?? true,
        refreshSec: snapshot.params?.refreshSec ?? LIVE_REFRESH_SECONDS,
        controls: snapshot.params?.controls ?? DEFAULT_SIMULATION_CONTROLS,
      },
    };
  } catch (error) {
    registerInitialStorageAlert(
      buildStorageAlert({
        key: `read-snapshot-${platformId}`,
        message: 'No se pudo restaurar el estado del simulador desde el almacenamiento local.',
        error,
      }),
    );
    return null;
  }
};

const persistPlatform = (
  platformId: PlatformId,
  pushStorageAlert: (alert: ReturnType<typeof buildStorageAlert>) => void,
) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, platformId);
  } catch (error) {
    pushStorageAlert(
      buildStorageAlert({
        key: 'write-platform',
        message: 'No se pudo guardar la última plataforma seleccionada.',
        error,
      }),
    );
  }
};

const persistSimulation = (
  platformId: PlatformId,
  snapshot: SimulationSnapshot,
  pushStorageAlert: (alert: ReturnType<typeof buildStorageAlert>) => void,
) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${STATE_STORAGE_PREFIX}${platformId}`, JSON.stringify(snapshot));
  } catch (error) {
    pushStorageAlert(
      buildStorageAlert({
        key: `write-snapshot-${platformId}`,
        message: 'No se pudo guardar el estado del simulador. Los cambios se perderán al refrescar.',
        error,
      }),
    );
  }
};

const computeCollateralStats = (
  assets: AssetState[],
  loanAmount: number,
  currency: string,
  policies?: {
    targetLtv?: number;
    marginCallLtv?: number;
    autoRepayLtv?: number;
    defaultLtv?: number;
  },
) => {
  const collateralValue = assets
    .filter((asset) => asset.useAsCollateral)
    .reduce((acc, asset) => acc + asset.qty * asset.price, 0);
  const totalValue = assets.reduce((acc, asset) => acc + asset.qty * asset.price, 0);
  const ltv = collateralValue > 0 ? loanAmount / collateralValue : 0;
  const { targetLtv = DEFAULT_SIMULATION_CONTROLS.ltv.initClamp ?? 0.25, marginCallLtv = 0.7, autoRepayLtv = 0.83 } =
    policies ?? {};
  return {
    collateralValue,
    totalValue,
    ltv,
    targetLtv,
    marginCallLtv,
    autoRepayLtv,
    loanHeadroom: collateralValue * targetLtv - loanAmount,
    formatted: {
      collateralValue: formatCurrency(collateralValue, currency),
      totalValue: formatCurrency(totalValue, currency),
      ltv: formatPercent(ltv),
      target: formatPercent(targetLtv),
      marginCall: formatPercent(marginCallLtv),
      autoRepay: formatPercent(autoRepayLtv),
    },
  };
};

const parseControls = (controls?: SimulationParams['controls']) => ({
  aprFundingAlpha: controls?.aprFundingAlpha ?? DEFAULT_SIMULATION_CONTROLS.aprFundingAlpha,
  aprClamp: controls?.aprClamp ?? DEFAULT_SIMULATION_CONTROLS.aprClamp,
  sigmaK: controls?.sigmaK ?? DEFAULT_SIMULATION_CONTROLS.sigmaK,
  ltvInitClamp: controls?.ltv?.initClamp ?? DEFAULT_SIMULATION_CONTROLS.ltv.initClamp,
});

const currentThemeForPlatform = (platformId: PlatformId) => {
  const platform = PLATFORM_BASE_CONFIGS[platformId];
  const theme = platform.theme && THEME_TOKENS[platform.theme] ? platform.theme : DEFAULT_THEME;
  return theme;
};

const LoanSummaryCard = ({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) => (
  <div className="rounded-xl border border-slate-200/40 bg-white/80 p-4 shadow-sm backdrop-blur">
    <p className="text-sm text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    <p className="mt-1 text-xs text-slate-500">{description}</p>
  </div>
);

const StorageAlertBanner = ({
  alerts,
  onDismiss,
}: {
  alerts: ReturnType<typeof buildStorageAlert>[];
  onDismiss: (key: string) => void;
}) => {
  if (!alerts.length) return null;
  return (
    <div className="mb-6 space-y-3">
      {alerts.map((alert) => (
        <div
          key={alert.key}
          className="flex items-start justify-between rounded-lg border border-amber-300/80 bg-amber-50/90 p-3 text-sm text-amber-900"
        >
          <div>
            <p className="font-medium">{alert.title ?? 'Almacenamiento limitado'}</p>
            <p className="mt-1 text-xs leading-snug">{alert.message}</p>
          </div>
          <button
            type="button"
            className="ml-4 text-xs font-medium text-amber-900/70 hover:text-amber-900"
            onClick={() => onDismiss(alert.key)}
          >
            Cerrar
          </button>
        </div>
      ))}
    </div>
  );
};

const AssetTable = ({
  assets,
  currency,
  onChange,
}: {
  assets: AssetState[];
  currency: string;
  onChange: (nextAssets: AssetState[]) => void;
}) => {
  const updateAsset = useCallback(
    (id: number, updates: Partial<AssetState>) => {
      onChange(
        assets.map((asset) =>
          asset.id === id
            ? {
                ...asset,
                ...updates,
              }
            : asset,
        ),
      );
    },
    [assets, onChange],
  );

  const removeAsset = useCallback(
    (id: number) => {
      onChange(assets.filter((asset) => asset.id !== id));
    },
    [assets, onChange],
  );

  const addAsset = useCallback(() => {
    const nextId = assets.length ? Math.max(...assets.map((asset) => asset.id)) + 1 : 1;
    onChange([
      ...assets,
      {
        id: nextId,
        name: `Asset ${nextId}`,
        ticker: '',
        qty: 0,
        price: 0,
        priceAuto: false,
        useAsCollateral: true,
      },
    ]);
  }, [assets, onChange]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/70 bg-white/90 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200/70 bg-slate-50/70 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-700">Cartera de colateral</h3>
        <button
          type="button"
          onClick={addAsset}
          className="rounded-md border border-slate-300/80 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          Añadir activo
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50/70 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Activo</th>
              <th className="px-4 py-3">Ticker</th>
              <th className="px-4 py-3 text-right">Cantidad</th>
              <th className="px-4 py-3 text-right">Precio</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-center">Colateral</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white/70">
            {assets.map((asset) => {
              const value = asset.qty * asset.price;
              return (
                <tr key={asset.id}>
                  <td className="px-4 py-3">
                    <input
                      className="w-full rounded-md border border-slate-300/80 px-2 py-1 text-sm"
                      value={asset.name}
                      onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      className="w-24 rounded-md border border-slate-300/80 px-2 py-1 text-sm uppercase"
                      value={asset.ticker}
                      onChange={(event) => updateAsset(asset.id, { ticker: event.target.value.toUpperCase() })}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      className="w-24 rounded-md border border-slate-300/80 px-2 py-1 text-right"
                      value={asset.qty}
                      onChange={(event) => updateAsset(asset.id, { qty: Number(event.target.value) || 0 })}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      className="w-24 rounded-md border border-slate-300/80 px-2 py-1 text-right"
                      value={asset.price}
                      onChange={(event) => updateAsset(asset.id, { price: Number(event.target.value) || 0 })}
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-600">
                    {formatCurrency(value, currency)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={asset.useAsCollateral}
                      onChange={(event) => updateAsset(asset.id, { useAsCollateral: event.target.checked })}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="rounded-md border border-red-200/80 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
                      onClick={() => removeAsset(asset.id)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SimulationControlsPanel = ({
  snapshot,
  onChange,
  currencyOptions,
}: {
  snapshot: SimulationSnapshot;
  onChange: (next: SimulationSnapshot) => void;
  currencyOptions: string[];
}) => {
  const updateField = (updates: Partial<SimulationSnapshot>) => {
    onChange({
      ...snapshot,
      ...updates,
    });
  };

  const updateParam = (updates: Partial<SimulationParams>) => {
    updateField({
      params: {
        ...snapshot.params,
        ...updates,
      },
    });
  };

  const controls = parseControls(snapshot.params.controls);

  return (
    <div className="grid gap-4 rounded-xl border border-slate-200/70 bg-white/80 p-4 shadow-sm lg:grid-cols-2">
      <div>
        <label className="block text-xs font-semibold uppercase text-slate-500">Monto del préstamo</label>
        <input
          type="number"
          className="mt-1 w-full rounded-md border border-slate-300/70 px-3 py-2 text-right text-sm"
          value={snapshot.loanAmount}
          onChange={(event) => updateField({ loanAmount: Number(event.target.value) || 0 })}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase text-slate-500">Días hasta el repago</label>
        <input
          type="number"
          className="mt-1 w-full rounded-md border border-slate-300/70 px-3 py-2 text-right text-sm"
          value={snapshot.repayInDays}
          onChange={(event) => updateField({ repayInDays: Number(event.target.value) || 0 })}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase text-slate-500">Moneda base</label>
        <select
          className="mt-1 w-full rounded-md border border-slate-300/70 px-3 py-2 text-sm"
          value={snapshot.currency}
          onChange={(event) => updateField({ currency: event.target.value })}
        >
          {currencyOptions.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase text-slate-500">Modelo de lealtad</label>
        <input
          className="mt-1 w-full rounded-md border border-slate-300/70 px-3 py-2 text-sm"
          value={snapshot.params.loyaltyModel}
          onChange={(event) => updateParam({ loyaltyModel: event.target.value })}
        />
      </div>
      <div className="lg:col-span-2">
        <label className="block text-xs font-semibold uppercase text-slate-500">Controles avanzados</label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="block text-[11px] uppercase tracking-wide text-slate-500">APR funding α</span>
            <input
              type="number"
              step="0.05"
              min={0}
              max={1}
              className="mt-1 w-full rounded-md border border-slate-300/70 px-2 py-1 text-sm"
              value={controls.aprFundingAlpha}
              onChange={(event) =>
                updateParam({
                  controls: {
                    ...snapshot.params.controls,
                    aprFundingAlpha: Number(event.target.value) || 0,
                  },
                })
              }
            />
          </div>
          <div>
            <span className="block text-[11px] uppercase tracking-wide text-slate-500">APR clamp</span>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full rounded-md border border-slate-300/70 px-2 py-1 text-sm"
              value={controls.aprClamp ?? ''}
              onChange={(event) =>
                updateParam({
                  controls: {
                    ...snapshot.params.controls,
                    aprClamp: event.target.value === '' ? null : Number(event.target.value),
                  },
                })
              }
            />
          </div>
          <div>
            <span className="block text-[11px] uppercase tracking-wide text-slate-500">Sigma K</span>
            <input
              type="number"
              step="0.1"
              className="mt-1 w-full rounded-md border border-slate-300/70 px-2 py-1 text-sm"
              value={controls.sigmaK}
              onChange={(event) =>
                updateParam({
                  controls: {
                    ...snapshot.params.controls,
                    sigmaK: Number(event.target.value) || 0,
                  },
                })
              }
            />
          </div>
          <div>
            <span className="block text-[11px] uppercase tracking-wide text-slate-500">LTV mínimo</span>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full rounded-md border border-slate-300/70 px-2 py-1 text-sm"
              value={controls.ltvInitClamp ?? ''}
              onChange={(event) =>
                updateParam({
                  controls: {
                    ...snapshot.params.controls,
                    ltv: {
                      ...snapshot.params.controls?.ltv,
                      initClamp: event.target.value === '' ? null : Number(event.target.value),
                    },
                  },
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const SimModelConfigPanel = ({
  onPushAlert,
}: {
  onPushAlert: (alert: ReturnType<typeof buildStorageAlert>) => void;
}) => {
  const [config, setConfig] = useState(() => readSimModelConfig());
  const [draft, setDraft] = useState(() => JSON.stringify(config, null, 2));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    writeSimModelConfigToDom(config);
  }, [config]);

  const saveDraft = useCallback(() => {
    try {
      const parsed = JSON.parse(draft);
      const sanitized = sanitizeSimModelConfig(parsed, config ?? createDefaultSimModelConfig());
      setConfig(sanitized);
      writeSimModelConfigToStorage(sanitized, onPushAlert);
      setIsEditing(false);
    } catch (error) {
      onPushAlert(
        buildStorageAlert({
          key: 'config-parse',
          message: 'No se pudo guardar la configuración dinámica. Revisá que el JSON sea válido.',
          error,
        }),
      );
    }
  }, [config, draft, onPushAlert]);

  const resetConfig = useCallback(() => {
    const base = readSimModelConfigFromDom();
    setConfig(base);
    setDraft(JSON.stringify(base, null, 2));
    clearSimModelConfigStorage(onPushAlert);
  }, [onPushAlert]);

  return (
    <div className="space-y-3 rounded-xl border border-slate-200/70 bg-white/80 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Configuración dinámica del modelo</h3>
        <div className="space-x-2">
          <button
            type="button"
            className="rounded-md border border-slate-300/80 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            onClick={() => setDraft(JSON.stringify(config, null, 2))}
          >
            Refrescar
          </button>
          <button
            type="button"
            className="rounded-md border border-red-200/70 px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
            onClick={resetConfig}
          >
            Reset
          </button>
        </div>
      </div>
      <textarea
        className="h-48 w-full rounded-md border border-slate-300/80 bg-white/90 px-3 py-2 text-xs font-mono text-slate-700"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setIsEditing(true);
        }}
      />
      <div className="flex items-center justify-end space-x-2 text-xs">
        <span className="text-slate-500">
          Versión actual: <strong>{config?.version ?? '—'}</strong>
        </span>
        <button
          type="button"
          className="rounded-md bg-slate-800 px-3 py-1 font-semibold text-white hover:bg-slate-900"
          onClick={saveDraft}
        >
          Guardar cambios
        </button>
        {isEditing && <span className="text-amber-600">Hay cambios sin guardar</span>}
      </div>
    </div>
  );
};

export function SimuladorPrestamos() {
  const {
    storageAlerts,
    registerInitialStorageAlert,
    pushStorageAlert,
    dismissStorageAlert,
  } = useStorageAlerts();

  const fallbackPlatformId = PLATFORM_IDS[0] as PlatformId;
  const [platformId, setPlatformId] = useState<PlatformId>(() => readStoredPlatform(registerInitialStorageAlert, fallbackPlatformId));

  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(() => {
    const stored = loadStoredSimulation(platformId, registerInitialStorageAlert);
    return stored ?? loadPlatformSnapshot(platformId);
  });

  useEffect(() => {
    persistPlatform(platformId, pushStorageAlert);
  }, [platformId, pushStorageAlert]);

  useEffect(() => {
    const stored = loadStoredSimulation(platformId, registerInitialStorageAlert);
    setSnapshot(stored ?? loadPlatformSnapshot(platformId));
  }, [platformId, registerInitialStorageAlert]);

  useEffect(() => {
    persistSimulation(platformId, snapshot, pushStorageAlert);
  }, [platformId, snapshot, pushStorageAlert]);

  useEffect(() => {
    const theme = currentThemeForPlatform(platformId);
    applyTheme(theme);
  }, [platformId]);

  const platform = PLATFORM_BASE_CONFIGS[platformId];
  const controls = parseControls(snapshot.params.controls);

  const collateralStats = useMemo(
    () => computeCollateralStats(snapshot.assets, snapshot.loanAmount, snapshot.currency, platform.policies),
    [snapshot.assets, snapshot.loanAmount, snapshot.currency, platform.policies],
  );

  const loyaltyTiers = useMemo(() => platform.loyalty?.tierThresholds ?? [], [platform.loyalty]);

  const currencyOptions = useMemo(() => {
    const presetCurrencies = Object.keys({ ...DEFAULT_EXCHANGE_RATES, ...snapshot.params.exchangeRates });
    const unique = Array.from(new Set([snapshot.currency, ...presetCurrencies]));
    return unique;
  }, [snapshot.currency, snapshot.params.exchangeRates]);

  const setAssets = useCallback(
    (assets: AssetState[]) => {
      setSnapshot((prev) => ({ ...prev, assets }));
    },
    [],
  );

  const resetToPreset = () => {
    setSnapshot(loadPlatformSnapshot(platformId));
  };

  const topAssets = snapshot.assets
    .filter((asset) => asset.useAsCollateral)
    .sort((a, b) => b.qty * b.price - a.qty * a.price)
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-10">
      <StorageAlertBanner alerts={storageAlerts} onDismiss={dismissStorageAlert} />
      <header className="space-y-4 rounded-3xl border border-slate-200/80 bg-white/80 p-6 text-slate-800 shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Simulador de préstamos</h1>
            <p className="mt-1 text-sm text-slate-600">Explorá escenarios CeFi con presets curados y controles avanzados.</p>
          </div>
          <div className="flex gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500">Plataforma</label>
              <select
                className="mt-1 rounded-md border border-slate-300/70 px-3 py-2 text-sm"
                value={platformId}
                onChange={(event) => setPlatformId(event.target.value as PlatformId)}
              >
                {PLATFORM_IDS.map((id) => (
                  <option key={id} value={id}>
                    {PLATFORM_BASE_CONFIGS[id].name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500">Refrescar preset</label>
              <button
                type="button"
                className="mt-1 w-full rounded-md border border-slate-300/80 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                onClick={resetToPreset}
              >
                Restaurar
              </button>
            </div>
          </div>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <LoanSummaryCard
            label="Colateral elegible"
            value={collateralStats.formatted.collateralValue}
            description="Valor de los activos marcados como colateral"
          />
          <LoanSummaryCard
            label="LTV actual"
            value={collateralStats.formatted.ltv}
            description="Relación préstamo/colateral"
          />
          <LoanSummaryCard
            label="LTV objetivo"
            value={collateralStats.formatted.target}
            description="Meta configurada por la plataforma"
          />
          <LoanSummaryCard
            label="Margen restante"
            value={formatCurrency(collateralStats.loanHeadroom, snapshot.currency)}
            description="Espacio hasta el LTV objetivo"
          />
        </dl>
      </header>

      <SimulationControlsPanel
        snapshot={snapshot}
        onChange={setSnapshot}
        currencyOptions={currencyOptions}
      />

      <AssetTable assets={snapshot.assets} currency={snapshot.currency} onChange={setAssets} />

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-slate-200/70 bg-white/80 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700">Resumen de políticas ({platform.name})</h3>
          <ul className="space-y-2 text-sm text-slate-600">
            <li>
              <strong>Política de margen:</strong> Llamado al {collateralStats.formatted.marginCall}, auto-repago al {collateralStats.formatted.autoRepay}.
            </li>
            <li>
              <strong>Target LTV:</strong> {collateralStats.formatted.target} • Controles dinámicos σ={formatNumber(controls.sigmaK, 1)}.
            </li>
            <li>
              <strong>Earn habilitado:</strong> {snapshot.params.earnOptIn ? 'Sí' : 'No'} · Earn sobre colateral: {snapshot.params.earnOnCollateral ? 'Sí' : 'No'}.
            </li>
            <li>
              <strong>Frecuencia de actualización:</strong> cada {snapshot.params.refreshSec ?? LIVE_REFRESH_SECONDS} segundos.
            </li>
          </ul>
          {topAssets.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top colateral</h4>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {topAssets.map((asset) => (
                  <li key={asset.id} className="flex justify-between">
                    <span>
                      {asset.name} <span className="text-xs text-slate-500">({asset.ticker})</span>
                    </span>
                    <span>{formatCurrency(asset.qty * asset.price, snapshot.currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-xl border border-slate-200/70 bg-white/80 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700">Loyalty tiers</h3>
          <ul className="space-y-2 text-sm text-slate-600">
            {loyaltyTiers.length === 0 && <li>No hay niveles de lealtad configurados.</li>}
            {loyaltyTiers.map((tier) => (
              <li key={tier.label} className="flex justify-between">
                <span>{tier.label}</span>
                <span>≥ {formatPercent(tier.minRatio ?? 0, 2)} de {platform.loyalty?.tokenTicker ?? 'token'}.</span>
              </li>
            ))}
          </ul>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Coingecko IDs monitoreados</h4>
            <p className="mt-2 text-xs text-slate-500">
              {Object.keys(BASE_GLOBAL_COINGECKO_IDS).slice(0, 12).join(', ')}{Object.keys(BASE_GLOBAL_COINGECKO_IDS).length > 12 ? '…' : ''}
            </p>
          </div>
        </div>
      </section>

      <SimModelConfigPanel onPushAlert={pushStorageAlert} />
    </div>
  );
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('SimuladorPrestamos ErrorBoundary', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-slate-50">
          <h1 className="text-2xl font-semibold">Algo salió mal</h1>
          <p className="mt-2 max-w-md text-center text-sm text-slate-300">
            Reinicia el simulador o recarga la página. Los presets se restaurarán automáticamente.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default SimuladorPrestamos;
