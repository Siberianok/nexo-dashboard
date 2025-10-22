// server/binanceClient.js
import crypto from 'crypto';
import fetch from 'node-fetch';

const DEFAULT_API_BASE = process.env.BINANCE_API_BASE || 'https://api.binance.com';
const DEFAULT_RECV_WINDOW = Number(process.env.BINANCE_RECV_WINDOW || 5000) || 5000;
const API_KEY = process.env.BINANCE_API_KEY || '';
const API_SECRET = process.env.BINANCE_API_SECRET || '';

const DEFAULT_HTTP_TIMEOUT_MS = Number(process.env.BINANCE_HTTP_TIMEOUT_MS || 25000) || 25000;
const FALLBACK_LOAN_COINS = (process.env.BINANCE_FALLBACK_LOAN_COINS || 'USDT,USDC,FDUSD')
  .split(',')
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);

// ============== Helpers ==============
const parseNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const parseRatio = (v) => {
  const num = Number(v);
  if (!Number.isFinite(num)) return null;
  return Math.abs(num) > 1 ? num / 100 : num;
};
const annualFromHourly = (h) => (h == null ? null : h * 24 * 365);

const normalizeArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload && typeof payload === 'object') return Object.values(payload);
  return [];
};

const createSignature = (payload, secret) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

const ensureCredentials = () => {
  if (!API_KEY || !API_SECRET) {
    const e = new Error('Binance API credentials are missing.');
    e.code = 'BINANCE_CREDENTIALS_MISSING';
    throw e;
  }
};

function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  const opts = { ...options, signal: controller.signal };
  return fetch(url, opts).finally(() => clearTimeout(id));
}

const fetchJson = async (url, options = {}) => {
  const t0 = Date.now();
  const res = await fetchWithTimeout(url, options, DEFAULT_HTTP_TIMEOUT_MS);
  const used = res.headers.get('x-mbx-used-weight');
  const used1m = res.headers.get('x-mbx-used-weight-1m');

  let body;
  try { body = await res.clone().json(); } catch { body = null; }

  console.log(`[binance] ${options?.method || 'GET'} ${url} -> ${res.status} used=${used} used1m=${used1m} took=${Date.now()-t0}ms rows=${Array.isArray(body?.rows) ? body.rows.length : (Array.isArray(body) ? body.length : 'n/a')}`);

  if (!res.ok) {
    const details = body?.msg || body?.message || (await res.text());
    const err = new Error(details || `HTTP ${res.status}`);
    err.status = res.status;
    if (body && typeof body === 'object' && body.code != null) err.code = body.code;
    err.binance = body;
    throw err;
  }
  return body;
};

const fetchServerTime = async (apiBase) => {
  const data = await fetchJson(`${apiBase}/api/v3/time`);
  const serverTime = Number(data?.serverTime);
  if (!Number.isFinite(serverTime)) throw new Error('Invalid server time response from Binance.');
  return serverTime;
};

const signedRequest = async (
  apiBase,
  path,
  params = {},
  { recvWindow = DEFAULT_RECV_WINDOW, timestamp } = {},
  method = 'GET'
) => {
  ensureCredentials();
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    query.append(k, v);
  });
  const resolvedTimestamp = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now();
  query.append('timestamp', `${Math.max(0, Math.floor(resolvedTimestamp))}`);
  if (recvWindow) query.append('recvWindow', `${recvWindow}`);
  const signature = createSignature(query.toString(), API_SECRET);
  query.append('signature', signature);

  const url = `${apiBase}${path}${method === 'GET' ? `?${query.toString()}` : ''}`;
  const init = { method, headers: { 'X-MBX-APIKEY': API_KEY } };
  if (method !== 'GET') {
    init.headers['content-type'] = 'application/x-www-form-urlencoded';
    init.body = query.toString();
  }
  return fetchJson(url, init);
};

// ============== Endpoints v2 ==============
export async function getLoanableDataV2({ apiBase = DEFAULT_API_BASE, loanCoin } = {}) {
  const params = {};
  if (loanCoin) params.loanCoin = loanCoin;
  return signedRequest(apiBase, '/sapi/v2/loan/flexible/loanable/data', params);
}

export async function getCollateralDataV2({ apiBase = DEFAULT_API_BASE, collateralCoin } = {}) {
  const params = {};
  if (collateralCoin) params.collateralCoin = collateralCoin;
  return signedRequest(apiBase, '/sapi/v2/loan/flexible/collateral/data', params);
}

export async function getOngoingLoans({ apiBase = DEFAULT_API_BASE, loanCoin, collateralCoin } = {}) {
  const params = {};
  if (loanCoin) params.loanCoin = loanCoin;
  if (collateralCoin) params.collateralCoin = collateralCoin;
  return signedRequest(apiBase, '/sapi/v2/loan/flexible/ongoing/orders', params);
}

// ============== Fallback por lotes para loanable ==============
async function getLoanableDataV2Batch({
  apiBase = DEFAULT_API_BASE,
  loanCoins = FALLBACK_LOAN_COINS,
  perRequestDelayMs = 150,
} = {}) {
  const all = [];
  for (const coin of loanCoins) {
    try {
      const payload = await getLoanableDataV2({ apiBase, loanCoin: coin });
      const rows = normalizeArray(payload);
      all.push(...rows);
    } catch (e) {
      console.warn(`[binance] fallback loanable(${coin}) falló: ${e?.message || e}`);
    }
    if (perRequestDelayMs > 0) {
      await new Promise(r => setTimeout(r, perRequestDelayMs));
    }
  }
  return all;
}

// ============== Transform (v2) ==============
const transformV2 = (loanableRows = [], collateralRows = []) => {
  const ltvByTicker = {};
  const collateralLedger = {};

  normalizeArray(collateralRows).forEach((row) => {
    const c = String(row?.collateralCoin).toUpperCase();
    if (!c) return;
    const initialLtv = parseRatio(row?.initialLTV);
    const marginCallLtv = parseRatio(row?.marginCallLTV);
    const liquidationLtv = parseRatio(row?.liquidationLTV);
    const maxLimit = parseNumber(row?.maxLimit);

    if (initialLtv != null) {
      const prev = ltvByTicker[c];
      ltvByTicker[c] = prev == null ? initialLtv : Math.max(prev, initialLtv);
    }
    collateralLedger[c] = { collateralAsset: c, initialLtv, marginCallLtv, liquidationLtv, collateralMaxLimitUSD: maxLimit };
  });

  const borrowRates = {};
  const loanLedger = {};

  normalizeArray(loanableRows).forEach((row) => {
    const loanCoin = String(row?.loanCoin).toUpperCase();
    if (!loanCoin) return;

    const hourly = parseNumber(row?.flexibleInterestRate); // por hora
    const annual = annualFromHourly(hourly);

    borrowRates[loanCoin] = {
      label: loanCoin,
      loanAsset: loanCoin,
      collateralAsset: null, // v2 separa colaterales
      annual: annual ?? 0,
      hourly: hourly ?? (annual != null ? annual / (365 * 24) : 0),
      netAnnual: annual ?? 0,
      adjustmentAnnual: 0,
      vipLevel: null,
      limitNote: 'Flexible Loan (v2) – datos firmados',
    };

    loanLedger[loanCoin] = {
      collateralAsset: null,
      loanAsset: loanCoin,
      initialLtv: null,
      marginCallLtv: null,
      liquidationLtv: null,
      collateralPrice: null,
      maxLoanAmount: parseNumber(row?.flexibleMaxLimit),
      minLoanAmount: parseNumber(row?.flexibleMinLimit),
      referenceDailyRate: annual != null ? annual / 365 : null,
      referenceYearlyRate: annual,
    };
  });

  return { ltvByTicker, borrowRates, loanLedger, collateralLedger };
};

// ============== Snapshot combinado con tolerancia a fallos ==============
export const fetchBinanceLoanSnapshot = async ({
  apiBase = DEFAULT_API_BASE,
  loanCoin,
  collateralCoin,
} = {}) => {
  ensureCredentials();

  // Sincronizar reloj
  const t0 = Date.now();
  const serverTime = await fetchServerTime(apiBase);
  const clockSkew = serverTime - Date.now();

  // 1) Intento normal en paralelo (loanable + collateral)
  const requestOptions = { recvWindow: DEFAULT_RECV_WINDOW, timestamp: Date.now() + clockSkew };
  const [loanableSet, collateralSet] = await Promise.allSettled([
    signedRequest(apiBase, '/sapi/v2/loan/flexible/loanable/data', loanCoin ? { loanCoin } : {}, requestOptions),
    signedRequest(apiBase, '/sapi/v2/loan/flexible/collateral/data', collateralCoin ? { collateralCoin } : {}, requestOptions),
  ]);

  let loanableRows = loanableSet.status === 'fulfilled' ? normalizeArray(loanableSet.value) : null;
  let collateralRows = collateralSet.status === 'fulfilled' ? normalizeArray(collateralSet.value) : [];

  const metadata = {
    timingsMs: { total: null, serverTime: null },
    endpointsTried: {
      loanable: '/sapi/v2/loan/flexible/loanable/data',
      collateral: '/sapi/v2/loan/flexible/collateral/data',
    },
    fallback: {
      usedBatchForLoanable: false,
      batchCoins: [],
      loanableFailed: loanableSet.status !== 'fulfilled',
      collateralFailed: collateralSet.status !== 'fulfilled',
    },
    requestParams: { loanCoin: loanCoin || null, collateralCoin: collateralCoin || null },
  };

  metadata.timingsMs.serverTime = Date.now() - t0;

  // 2) Si loanable vino vacío o falló → fallback por lotes (USDT/USDC/FDUSD)
  if (!loanableRows || loanableRows.length === 0) {
    try {
      const batchRows = await getLoanableDataV2Batch({ apiBase, loanCoins: FALLBACK_LOAN_COINS });
      if (batchRows.length > 0) {
        loanableRows = batchRows;
        metadata.fallback.usedBatchForLoanable = true;
        metadata.fallback.batchCoins = FALLBACK_LOAN_COINS;
      }
    } catch (e) {
      console.warn('[binance] fallback batch total falló:', e?.message || e);
    }
  }

  // 3) Transform y salida
  const transformed = transformV2(loanableRows || [], collateralRows || []);
  metadata.timingsMs.total = Date.now() - t0;

  return {
    source: 'binance_flexible_v2',
    fetchedAt: new Date().toISOString(),
    serverTime,
    clockSkew,
    rowCount: {
      loanable: (loanableRows || []).length,
      collateral: (collateralRows || []).length,
    },
    config: transformed,
    metadata: {
      ...metadata,
      notes: (!loanableRows || loanableRows.length === 0)
        ? 'Snapshot sin loanable (solo collateral).'
        : (metadata.fallback.usedBatchForLoanable
            ? 'Snapshot con fallback parcial para loanable.'
            : 'Snapshot con loanable+collateral normales.'),
    },
  };
};
