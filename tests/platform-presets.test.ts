import { describe, expect, it } from 'vitest';
import { BASE_GLOBAL_COINGECKO_IDS, PLATFORM_BASE_CONFIGS, PLATFORM_IDS } from '../src/data/platformPresets';

const approxEq = (a: number | null | undefined, b: number, eps = 1e-6) => {
  if (typeof a !== 'number' || !Number.isFinite(a)) return false;
  return Math.abs(a - b) <= eps;
};

describe('platform presets sanity', () => {
  const nexo = PLATFORM_BASE_CONFIGS.nexo;
  const binance = PLATFORM_BASE_CONFIGS.binance;
  const youhodler = PLATFORM_BASE_CONFIGS.youhodler;
  const ledn = PLATFORM_BASE_CONFIGS.ledn;

  it('mantiene los parámetros críticos de Nexo', () => {
    expect(approxEq(nexo.policies?.targetLtv ?? 0, 0.2)).toBe(true);
    expect(approxEq(nexo.ltvByTicker?.BTC ?? 0, 0.5)).toBe(true);
    expect(nexo.apr?.lowCostEligibleTiers || []).toEqual(expect.arrayContaining(['Gold', 'Platinum']));
    expect((nexo.defaultAssets?.[0]?.ticker || '').toUpperCase()).toBe('BTC');
  });

  it('mantiene las métricas de Binance', () => {
    expect((binance.earnAprTop?.BNB ?? 0)).toBeGreaterThanOrEqual(0.05);
  });

  it('mantiene las plataformas registradas', () => {
    expect(PLATFORM_IDS).toEqual(expect.arrayContaining(['nexo', 'binance', 'youhodler', 'ledn']));
  });

  it('mantiene los umbrales de LTV de YouHodler y Ledn', () => {
    expect((youhodler?.policies?.targetLtv ?? 0)).toBeGreaterThanOrEqual(0.7);
    expect((ledn?.ltvByTicker?.BTC ?? 0)).toBeLessThanOrEqual(0.7);
  });

  it('expone los identificadores de CoinGecko', () => {
    expect(BASE_GLOBAL_COINGECKO_IDS.BTC).toBe('bitcoin');
  });
});
