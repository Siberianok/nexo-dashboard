// @ts-nocheck
import { createResilientApiClient } from '../lib/resilientClient';

export const initDynamicModel = () => {
    const DEFAULT_STORAGE_RECOVERY_HINT = 'Sugerencia: revisá los permisos de almacenamiento del navegador o usá los botones "Reset" en Plantillas & datos.';
    const buildStorageAlert = ({ key, title = 'Preferencias no disponibles', message, error, hint = DEFAULT_STORAGE_RECOVERY_HINT, tone = 'warn' }) => {
      const detail = error ? ` Detalle: ${error?.message || error}.` : '';
      return {
        key,
        title,
        message: `${message}${detail}`,
        hint,
        tone,
      };
    };

    const LOG_PREFIX = '[nexo-sim]';
    const NAMESPACE = '__nexoSim';
    const DEFAULT_CONFIG = {
      forceOn: true,
      refreshMs: 5 * 60 * 1000,
      timeoutMs: 12000,
      aprFundingAlpha: 0.35,
      loanAprClamp: { min: 0.015, max: 0.28 },
      netApr: {
        useVip: true,
        ltvDivisor: 'current',
        aprClamp: { min: -0.25, max: 0.32 },
        nonNegative: true,
      },
      baseAPR: {
        USDT: 0.059,
        USDC: 0.057,
        BUSD: 0.058,
        FDUSD: 0.056,
        BTC: 0.072,
        ETH: 0.068,
        BNB: 0.065,
      },
      loanCoins: ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'BNB'],
      fundingSymbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'AVAXUSDT'],
      collateralYield: {
        BTC: { apr: 0.02 },
        ETH: { apr: 0.022 },
        BNB: { apr: 0.025 },
        SOL: { apr: 0.02 },
        XRP: { apr: 0.012 },
        ADA: { apr: 0.00038 },
        ALGO: { apr: 0.00047 },
        AVAX: { apr: 0.018 },
        DOGE: { apr: 0.006 },
        MATIC: { apr: 0.014 },
        LINK: { apr: 0.015 },
        ARB: { apr: 0.016 },
        OP: { apr: 0.016 },
      },
      assetOverrides: {
        BNB: { liqBias: -0.05 },
        SOL: { liqBias: 0.05 },
        DOGE: { liqBias: 0.08 },
        ADA: { initialLtv: 0.7478646456062593, marginCallLtv: 0.8, liquidationLtv: 0.84124 },
        ALGO: { initialLtv: 0.6398718015265647, marginCallLtv: 0.8, liquidationLtv: 0.85143 },
      },
      skipAssets: ['USDT', 'USDC', 'BUSD', 'TUSD', 'FDUSD'],
      universe: {
        maxAssets: 12,
        fallback: ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOGE', 'MATIC', 'LINK', 'ARB', 'OP'],
      },
      ltvModel: {
        initMin: 0.35,
        initMax: 0.75,
        sigmaK: 2.6,
        sigmaFallback: 0.015,
        sigmaFloor: 0.005,
        mcStep: 0.1,
        liqStep: 0.07,
        liqCap: 0.9,
        epsilon: 0.01,
      },
      vip: {
        level: 3,
        discounts: {
          0: 0,
          1: 0.003,
          2: 0.006,
          3: 0.01,
          4: 0.0125,
          5: 0.015,
        },
        fallbackDiscount: 0.01,
      },
    };

    const baseFetch = (() => {
      if (window.__nexoShimClient && typeof window.__nexoShimClient.fetch === 'function') {
        return window.__nexoShimClient.fetch;
      }
      if (typeof window.fetch === 'function') {
        return window.fetch.bind(window);
      }
      return null;
    })();

    const resilientApiClient = baseFetch
      ? createResilientApiClient({ fetchFn: baseFetch, logger: console, namespace: 'nexoSimApi', logPrefix: LOG_PREFIX })
      : null;

    const resilientFetchJson = resilientApiClient ? resilientApiClient.requestJson : null;

    const clone = (value) => {
      if (Array.isArray(value)) return value.map(clone);
      if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).forEach((key) => {
          out[key] = clone(value[key]);
        });
        return out;
      }
      return value;
    };

    const mergeDeep = (target, source) => {
      if (!source || typeof source !== 'object') return target;
      Object.keys(source).forEach((key) => {
        const incoming = source[key];
        if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
          target[key] = mergeDeep(target[key] && typeof target[key] === 'object' ? target[key] : {}, incoming);
        } else {
          target[key] = clone(incoming);
        }
      });
      return target;
    };

    const existingNamespace = window[NAMESPACE] && typeof window[NAMESPACE] === 'object' ? window[NAMESPACE] : null;
    const runtimeConfig = clone(DEFAULT_CONFIG);
    if (existingNamespace && existingNamespace.config) {
      mergeDeep(runtimeConfig, existingNamespace.config);
    }
    if (window.__nexoSimConfig && typeof window.__nexoSimConfig === 'object') {
      mergeDeep(runtimeConfig, window.__nexoSimConfig);
    }

    const activationParam = (() => {
      try {
        const url = new URL(window.location.href);
        return url.searchParams.get('sim');
      } catch (error) {
        console.warn(LOG_PREFIX, 'No se pudo leer los parámetros de la URL.', error);
        return null;
      }
    })();

    if (!(runtimeConfig.forceOn || activationParam === '1')) {
      return;
    }

    const upstreamFetch = baseFetch;
    if (!upstreamFetch) {
      console.warn(LOG_PREFIX, 'fetch no está disponible, abortando shim dinámico.');
      return;
    }

    console.info(LOG_PREFIX, 'Shim dinámico activo (modelo: dynamic_model).');

    const state = {
      snapshot: existingNamespace && existingNamespace.snapshot ? existingNamespace.snapshot : null,
      lastTs: 0,
      inflight: null,
    };

    const toNumber = (value, fallback = 0) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    const clamp = (value, range) => {
      const min = Array.isArray(range) ? toNumber(range[0], -Infinity) : -Infinity;
      const max = Array.isArray(range) ? toNumber(range[1], Infinity) : Infinity;
      const num = toNumber(value, min);
      return Math.min(max, Math.max(min, num));
    };

    const uniqPush = (list, value) => {
      const upper = (value || '').toUpperCase();
      if (!upper) return;
      if (!list.set.has(upper)) {
        list.set.add(upper);
        list.values.push(upper);
      }
    };

    const createJsonResponse = (payload, init) => new Response(JSON.stringify(payload, null, 2), {
      status: (init && init.status) || 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(init && init.headers ? init.headers : {}),
      },
    });

    const withTimeout = async (promise, timeoutMs, label) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await promise(controller.signal);
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw new Error(label ? `${label}: timeout tras ${timeoutMs}ms` : `timeout tras ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };

    const jget = async (url) => withTimeout(async (signal) => {
      const response = await upstreamFetch(url, { cache: 'no-store', signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} al consultar ${url}`);
      }
      return response.json();
    }, runtimeConfig.timeoutMs, `GET ${url}`);

    const SUFFIX_BLACKLIST = ['UP', 'DOWN', 'BULL', 'BEAR'];
    const buildSkipSet = () => {
      const fromUniverse = runtimeConfig.universe && Array.isArray(runtimeConfig.universe.skipAssets)
        ? runtimeConfig.universe.skipAssets
        : [];
      const combined = [...(runtimeConfig.skipAssets || []), ...fromUniverse];
      return new Set(combined.map((item) => (item || '').toUpperCase()));
    };
    const loadUniverseAuto = async (maxN, skipSet) => {
      const fallback = Array.isArray(runtimeConfig.universe && runtimeConfig.universe.fallback)
        ? runtimeConfig.universe.fallback.map((item) => (item || '').toUpperCase())
        : [];
      try {
        const raw = await jget('https://api.binance.com/api/v3/ticker/24hr');
        if (!Array.isArray(raw)) throw new Error('Respuesta inesperada.');
        const ranking = raw
          .filter((entry) => {
            if (!entry || typeof entry.symbol !== 'string') return false;
            if (!/USDT$/i.test(entry.symbol)) return false;
            const base = entry.symbol.replace(/USDT$/i, '').toUpperCase();
            if (!base) return false;
            if (skipSet.has(base)) return false;
            if (SUFFIX_BLACKLIST.some((suffix) => base.endsWith(suffix))) return false;
            return true;
          })
          .map((entry) => ({
            base: entry.symbol.replace(/USDT$/i, '').toUpperCase(),
            quoteVolume: toNumber(entry.quoteVolume),
          }))
          .sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));
        const collector = { values: [], set: new Set() };
        for (const item of ranking) {
          if (collector.values.length >= maxN) break;
          uniqPush(collector, item.base);
        }
        if (collector.values.length === 0 && fallback.length) {
          fallback.forEach((asset) => uniqPush(collector, asset));
        }
        return collector.values.slice(0, maxN);
      } catch (error) {
        console.warn(LOG_PREFIX, 'Fallo loadUniverseAuto, usando fallback.', error);
        return fallback.slice(0, maxN);
      }
    };

    const computeFundingAnnualized = async () => {
      const symbols = Array.isArray(runtimeConfig.fundingSymbols) ? runtimeConfig.fundingSymbols : [];
      const results = {};
      await Promise.all(symbols.map(async (symbol) => {
        try {
          const data = await jget(`https://fapi.binance.com/fapi/v1/fundingRate?limit=24&symbol=${encodeURIComponent(symbol)}`);
          if (Array.isArray(data) && data.length) {
            const rates = data
              .map((entry) => toNumber(entry.fundingRate))
              .filter((value) => Number.isFinite(value));
            if (rates.length) {
              const meanAbs = rates.reduce((acc, value) => acc + Math.abs(value), 0) / rates.length;
              results[symbol] = meanAbs * 3 * 365;
            }
          }
        } catch (error) {
          console.warn(LOG_PREFIX, `No se pudo cargar fundingRate para ${symbol}:`, error);
        }
      }));
      const values = Object.values(results).filter((value) => Number.isFinite(value));
      const marketFundingAnnual = values.length
        ? values.reduce((acc, value) => acc + value, 0) / values.length
        : 0;
      return { perSymbol: results, marketFundingAnnual };
    };

    const computeSigmaForAsset = async (asset) => {
      const symbol = `${asset}USDT`;
      try {
        const data = await jget(`https://api.binance.com/api/v3/klines?interval=1h&limit=25&symbol=${encodeURIComponent(symbol)}`);
        if (!Array.isArray(data) || data.length < 2) throw new Error('Datos insuficientes');
        const closes = data
          .map((entry) => Array.isArray(entry) ? toNumber(entry[4]) : NaN)
          .filter((value) => Number.isFinite(value));
        if (closes.length < 2) throw new Error('Cierres insuficientes');
        const returns = [];
        for (let i = 1; i < closes.length; i += 1) {
          const prev = closes[i - 1];
          const current = closes[i];
          if (prev > 0 && current > 0) {
            returns.push((current - prev) / prev);
          }
        }
        if (!returns.length) throw new Error('Sin variaciones');
        const mean = returns.reduce((acc, value) => acc + value, 0) / returns.length;
        const variance = returns.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / returns.length;
        const sigma = Math.sqrt(Math.max(variance, 0));
        return sigma;
      } catch (error) {
        console.warn(LOG_PREFIX, `Fallo sigma para ${asset}:`, error);
        return runtimeConfig.ltvModel.sigmaFallback;
      }
    };

    const ensureLtvOrdering = (init, mc, liq, liqCap, epsilon) => {
      let initial = init;
      let margin = mc;
      let liquidation = liq;
      if (!(margin > initial)) {
        margin = Math.min(liqCap, initial + epsilon);
      }
      if (!(liquidation > margin)) {
        liquidation = Math.min(liqCap, margin + epsilon);
      }
      return { initial, margin, liquidation };
    };

    const buildCollateralEntry = (asset, sigma) => {
      const model = runtimeConfig.ltvModel;
      const overrides = runtimeConfig.assetOverrides && runtimeConfig.assetOverrides[asset] ? runtimeConfig.assetOverrides[asset] : {};
      const safeSigma = Math.max(model.sigmaFloor, Number.isFinite(sigma) ? sigma : model.sigmaFallback);
      let init = clamp(model.initMax - model.sigmaK * safeSigma, [model.initMin, model.initMax]);
      if (typeof overrides.initialLtv === 'number') {
        init = clamp(overrides.initialLtv, [model.initMin, model.initMax]);
      }
      let mc = clamp(init + model.mcStep, [init, model.liqCap]);
      if (typeof overrides.marginCallLtv === 'number') {
        mc = clamp(overrides.marginCallLtv, [init, model.liqCap]);
      }
      let liq = clamp(mc + model.liqStep, [mc, model.liqCap]);
      if (typeof overrides.liquidationLtv === 'number') {
        liq = clamp(overrides.liquidationLtv, [mc, model.liqCap]);
      }
      if (typeof overrides.liqBias === 'number') {
        liq = clamp(liq * (1 + overrides.liqBias), [mc, model.liqCap]);
      }
      const ordered = ensureLtvOrdering(init, mc, liq, model.liqCap, model.epsilon);
      return {
        asset,
        sigma: safeSigma,
        initialLtv: ordered.initial,
        marginCallLtv: ordered.margin,
        liquidationLtv: ordered.liquidation,
      };
    };

    const deriveLoanUniverse = (autoUniverse, skip) => {
      const result = { values: [], set: new Set() };
      autoUniverse.forEach((asset) => {
        const upper = (asset || '').toUpperCase();
        if (!upper || skip.has(upper)) return;
        uniqPush(result, upper);
      });
      const fallback = Array.isArray(runtimeConfig.universe && runtimeConfig.universe.fallback)
        ? runtimeConfig.universe.fallback
        : [];
      fallback.forEach((asset) => {
        const upper = (asset || '').toUpperCase();
        if (!upper || skip.has(upper)) return;
        if (result.values.length >= runtimeConfig.universe.maxAssets) return;
        uniqPush(result, upper);
      });
      return result.values.slice(0, runtimeConfig.universe.maxAssets);
    };

    const computeSnapshot = async () => {
      const skipSet = buildSkipSet();
      const autoUniverse = await loadUniverseAuto(runtimeConfig.universe.maxAssets, skipSet);
      const collateralUniverse = deriveLoanUniverse(autoUniverse, skipSet);
      const funding = await computeFundingAnnualized();
      const sigmaEntries = await Promise.all(collateralUniverse.map(async (asset) => [asset, await computeSigmaForAsset(asset)]));
      const sigmaByAsset = sigmaEntries.reduce((acc, [asset, sigma]) => {
        acc[asset] = sigma;
        return acc;
      }, {});
      const collateralEntries = collateralUniverse.map((asset) => buildCollateralEntry(asset, sigmaByAsset[asset]));
      const ltvByTicker = collateralEntries.reduce((acc, entry) => {
        acc[entry.asset] = entry.initialLtv;
        return acc;
      }, {});
      const collateralLedger = collateralEntries.reduce((acc, entry) => {
        acc[entry.asset] = {
          initialLtv: entry.initialLtv,
          marginCallLtv: entry.marginCallLtv,
          liquidationLtv: entry.liquidationLtv,
        };
        return acc;
      }, {});

      const loanCoins = Array.isArray(runtimeConfig.loanCoins) && runtimeConfig.loanCoins.length
        ? runtimeConfig.loanCoins
        : Object.keys(runtimeConfig.baseAPR || {});
      const borrowRates = {};
      const loanLedger = {};
      const vipLevel = runtimeConfig.vip && typeof runtimeConfig.vip.level === 'number' ? runtimeConfig.vip.level : 0;
      const discountTable = (runtimeConfig.vip && runtimeConfig.vip.discounts) || {};
      const vipDiscount = typeof discountTable[vipLevel] === 'number'
        ? discountTable[vipLevel]
        : runtimeConfig.vip && typeof runtimeConfig.vip.fallbackDiscount === 'number'
          ? runtimeConfig.vip.fallbackDiscount
          : 0;
      const aprClampBounds = runtimeConfig.loanAprClamp || { min: 0, max: 1 };

      loanCoins.forEach((coin) => {
        const upper = (coin || '').toUpperCase();
        const baseApr = toNumber(runtimeConfig.baseAPR && runtimeConfig.baseAPR[upper], 0.04);
        const annualRaw = clamp(baseApr + runtimeConfig.aprFundingAlpha * funding.marketFundingAnnual, [aprClampBounds.min, aprClampBounds.max]);
        const vipAnnual = clamp(annualRaw - vipDiscount, [aprClampBounds.min, aprClampBounds.max]);
        const hourly = annualRaw / (365 * 24);
        borrowRates[upper] = {
          annual: annualRaw,
          hourly,
          vipAnnual,
          netAnnual: vipAnnual,
          loanAsset: upper,
          label: `${upper} · Simulado`,
          source: 'dynamic_model',
        };
        loanLedger[upper] = {
          referenceYearlyRate: annualRaw,
          referenceDailyRate: annualRaw / 365,
        };
      });

      const fetchedAt = new Date().toISOString();
      const snapshot = {
        source: 'dynamic_model',
        fetchedAt,
        serverTime: Date.now(),
        config: {
          ltvByTicker,
          borrowRates,
          loanLedger,
          collateralLedger,
        },
        metadata: {
          model: 'dynamic_model',
          computedAt: fetchedAt,
          refreshMs: runtimeConfig.refreshMs,
          aprFundingAlpha: runtimeConfig.aprFundingAlpha,
          funding,
          sigmaByAsset,
          collateralYield: runtimeConfig.collateralYield,
          vipLevel,
          aprClamp: runtimeConfig.netApr && runtimeConfig.netApr.aprClamp ? runtimeConfig.netApr.aprClamp : null,
          autoUniverse,
          collateralUniverse,
        },
        rowCount: {
          loanable: Object.keys(borrowRates).length,
          collateral: collateralEntries.length,
        },
      };

      state.snapshot = snapshot;
      state.lastTs = Date.now();

      window[NAMESPACE] = window[NAMESPACE] && typeof window[NAMESPACE] === 'object' ? window[NAMESPACE] : {};
      window[NAMESPACE].snapshot = snapshot;
      window[NAMESPACE].config = runtimeConfig;

      console.info(LOG_PREFIX, 'Snapshot dynamic_model actualizado.', {
        loanable: snapshot.rowCount.loanable,
        collateral: snapshot.rowCount.collateral,
      });

      return snapshot;
    };

    const ensureSnapshot = async (force) => {
      const now = Date.now();
      if (!force && state.snapshot && state.lastTs && (now - state.lastTs) < runtimeConfig.refreshMs) {
        return state.snapshot;
      }
      if (state.inflight) {
        return state.inflight;
      }
      state.inflight = computeSnapshot().catch((error) => {
        console.warn(LOG_PREFIX, 'No se pudo actualizar snapshot:', error);
        state.inflight = null;
        if (state.snapshot) return state.snapshot;
        throw error;
      }).then((snapshot) => {
        state.inflight = null;
        return snapshot;
      });
      return state.inflight;
    };

    const respondLoans = async () => {
      const snapshot = await ensureSnapshot();
      const ageMs = state.lastTs ? Math.max(0, Date.now() - state.lastTs) : null;
      return createJsonResponse({
        ...snapshot,
        ageMs,
        cached: true,
        stale: false,
      });
    };

    const respondAdminState = () => {
      const hasCache = !!state.snapshot;
      const cacheTs = state.lastTs || null;
      const ageMs = cacheTs ? Math.max(0, Date.now() - cacheTs) : null;
      return createJsonResponse({
        hasCache,
        cacheTs,
        ageMs,
        cacheSource: 'dynamic',
      });
    };

    const respondLoanable = async (url) => {
      const snapshot = await ensureSnapshot();
      const query = url.searchParams.get('loanCoin');
      const rows = Object.entries(snapshot.config.borrowRates).map(([loanCoin, info]) => ({
        loanCoin,
        yearlyInterestRate: info.annual,
        hourlyInterestRate: info.hourly,
        vipYearlyInterestRate: info.vipAnnual,
      })).filter((row) => !query || row.loanCoin === query.toUpperCase());
      return createJsonResponse({
        total: rows.length,
        rows,
        source: 'dynamic_model',
      });
    };

    const respondCollateral = async (url) => {
      const snapshot = await ensureSnapshot();
      const query = url.searchParams.get('collateralCoin');
      const rows = Object.entries(snapshot.config.collateralLedger).map(([collateralCoin, info]) => ({
        collateralCoin,
        initialLTV: info.initialLtv,
        marginCallLTV: info.marginCallLtv,
        liquidationLTV: info.liquidationLtv,
      })).filter((row) => !query || row.collateralCoin === query.toUpperCase());
      return createJsonResponse({
        total: rows.length,
        rows,
        source: 'dynamic_model',
      });
    };

    const computePairNetAPR = ({ loanCoin, collateralCoin, ltvCurrent }) => {
      const snapshot = state.snapshot;
      if (!snapshot) {
        console.warn(LOG_PREFIX, 'Snapshot no disponible para computePairNetAPR.');
        return null;
      }
      const netConfig = runtimeConfig.netApr || {};
      const loanKey = (loanCoin || '').toUpperCase();
      const collateralKey = (collateralCoin || '').toUpperCase();
      const loanInfo = snapshot.config && snapshot.config.borrowRates ? snapshot.config.borrowRates[loanKey] : null;
      if (!loanInfo) return null;
      const collateralYieldEntry = runtimeConfig.collateralYield && runtimeConfig.collateralYield[collateralKey];
      const collateralAPR = collateralYieldEntry && typeof collateralYieldEntry.apr === 'number' ? collateralYieldEntry.apr : 0;
      const initialLtv = snapshot.config && snapshot.config.collateralLedger && snapshot.config.collateralLedger[collateralKey]
        ? snapshot.config.collateralLedger[collateralKey].initialLtv
        : null;
      const loanAPR = netConfig.useVip ? toNumber(loanInfo.vipAnnual, loanInfo.annual) : toNumber(loanInfo.annual);
      const divisorMode = (netConfig.ltvDivisor || 'current').toLowerCase();
      const divisor = divisorMode === 'current' ? toNumber(ltvCurrent, initialLtv || 0) : toNumber(initialLtv, ltvCurrent || 0);
      const clampConfig = netConfig.aprClamp || {};
      const applyClamp = (value) => {
        let next = value;
        if (typeof clampConfig.min === 'number') next = Math.max(clampConfig.min, next);
        if (typeof clampConfig.max === 'number') next = Math.min(clampConfig.max, next);
        if (netConfig.nonNegative) next = Math.max(0, next);
        return next;
      };
      if (!(collateralAPR > 0) || !(divisor > 0)) {
        return applyClamp(loanAPR);
      }
      const net = loanAPR - (collateralAPR / divisor);
      return applyClamp(net);
    };

    const getDynamicStatus = () => {
      const snapshot = state.snapshot || null;
      const cacheTs = state.lastTs || null;
      const ageMs = cacheTs ? Math.max(0, Date.now() - cacheTs) : null;
      return {
        hasCache: !!snapshot,
        cacheTs,
        ageMs,
        snapshot,
        source: snapshot?.source || 'dynamic_model',
        metadata: snapshot?.metadata || null,
      };
    };

    window[NAMESPACE] = window[NAMESPACE] && typeof window[NAMESPACE] === 'object' ? window[NAMESPACE] : {};
    window[NAMESPACE].config = runtimeConfig;
    window[NAMESPACE].computePairNetAPR = computePairNetAPR;
    window[NAMESPACE].getStatus = getDynamicStatus;
    window[NAMESPACE].remotePresetDisabled = true;

    ensureSnapshot().catch((error) => {
      console.warn(LOG_PREFIX, 'Error inicial al preparar snapshot dinámico:', error);
    });

    const dynamicModelFetch = async function dynamicModelFetch(input, init) {
      try {
        const requestInit = init || {};
        const method = ((requestInit.method) || (typeof input === 'object' && input && input.method) || 'GET').toUpperCase();
        if (method !== 'GET') {
          return upstreamFetch(input, init);
        }
        const url = (() => {
          try {
            if (typeof input === 'string') return new URL(input, window.location.href);
            if (input && typeof input.url === 'string') return new URL(input.url, window.location.href);
          } catch (error) {
            console.warn(LOG_PREFIX, 'No se pudo parsear URL para fetch interceptado.', error);
          }
          return null;
        })();
        if (!url || url.origin !== window.location.origin) {
          return upstreamFetch(input, init);
        }
        const pathname = url.pathname.replace(/\/+$/, '') || url.pathname;
        if (pathname === '/api/binance/loans' || pathname === '/api/binance/snapshot') {
          return respondLoans();
        }
        if (pathname === '/api/admin/state') {
          return respondAdminState();
        }
        if (pathname === '/api/binance/loanable') {
          return respondLoanable(url);
        }
        if (pathname === '/api/binance/collateral') {
          return respondCollateral(url);
        }
      } catch (error) {
        console.warn(LOG_PREFIX, 'Error en interceptación de fetch:', error);
      }
      return upstreamFetch(input, init);
    };

    const existingApiClient = (window.__nexoApiClient && typeof window.__nexoApiClient === 'object')
      ? window.__nexoApiClient
      : {};
    const appFetch = dynamicModelFetch;
    window.__nexoApiClient = { ...existingApiClient, fetch: appFetch, baseFetch, resilient: resilientApiClient };
  
};
