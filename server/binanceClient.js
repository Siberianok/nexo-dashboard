// Binance client — Flexible Loans v2 con timeout, firma HMAC y logging de weights
// Requiere: BINANCE_API_KEY y BINANCE_API_SECRET en variables de entorno

import crypto from 'crypto';
import fetch from 'node-fetch'; // Si usás Node >=18, podés cambiar a fetch nativo y quitar esta dep.

const DEFAULT_API_BASE = process.env.BINANCE_API_BASE || 'https://api.binance.com';
const DEFAULT_RECV_WINDOW = Number(process.env.BINANCE_RECV_WINDOW || 5000) || 5000;
const API_KEY = process.env.BINANCE_API_KEY || '';
const API_SECRET = process.env.BINANCE_API_SECRET || '';
const DEFAULT_TIMEOUT_MS = Number(process.env.BINANCE_HTTP_TIMEOUT_MS || 10000) || 10000; // timeout por request

// ==== Helpers ====
const parseNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const parseRatio = (v) => {
  const num = Number(v);
  if (!Number.isFinite(num)) return null;
  return Math.abs(num) > 1 ? num / 100 : num;
};
const hourlyFromAnnual = (a) => (a == null ? null : a / (365 * 24));
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

// fetch con timeout duro (AbortController)
function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  const opts = { ...options, signal: controller.signal };
  return fetch(url, opts).finally(() => clearTimeout(id));
}

const fetchJson = async (url, options = {}) => {
  const res = await fetchWithTimeout(url, options, DEFAULT_TIMEOUT_MS);
  const used = res.headers.get('x-mbx-used-weight');
  const used1m = res.headers.get('x-mbx-used-weight-1m');
  // Log informativo para vigilar peso por IP
  console.log(`[binance] ${options?.method || 'GET'} ${url} -> ${res.status} used=${used} used1m=${used1m}`);

  let data = null;
  try { data = await res.clone().json(); } catch {}
  if (!res.ok) {
    const details = data?.msg || data?.message || (await res.text());
    const err = new Error(details || `HTTP ${res.status}`);
    err.status = res.status;
    if (data && typeof data === 'object' && data.code != null) err.code = data.code;
    err.binance = data;
    throw err;
  }
  return data;
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

// ==== Endpoints v2 (Flexible Rate) ====
// Tasas / límites por asset a pedir
export async function getLoanableDataV2({ apiBase = DEFAULT_API_BASE, loanCoin } = {}) {
  const params = {};
  if (loanCoin) params.loanCoin = loanCoin;
  return signedRequest(apiBase, '/sapi/v2/loan/flexible/loanable/data', params);
}

// LTVs / límites por colateral
export async function getCollateralDataV2({ apiBase = DEFAULT_API_BASE, collateralCoin } = {}) {
  const params = {};
  if (collateralCoin) params.collateralCoin = collateralCoin;
  return signedRequest(apiBase, '/sapi/v2/loan/flexible/collateral/data', params);
}

// Préstamos activos (ongoing orders)
export async function getOngoingLoans({ apiBase = DEFAULT_API_BASE, loanCoin, collateralCoin } = {}) {
  const params = {};
  if (loanCoin) params.loanCoin = loanCoin;
  if (collateralCoin) params.collateralCoin = collateralCoin;
  return signedRequest(apiBase, '/sapi/v2/loan/flexible/ongoing/orders', params);
}

// ==== Transform combinado (loanable + collateral) para la UI ====
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
    const hourly = parseNumber(row?.flexibleInterestRate); // por HORA
    const annual = hourly != null ? hourly * 24 * 365 : null;

    borrowRates[loanCoin] = {
      label: loanCoin,
      loanAsset: loanCoin,
      collateralAsset: null, // v2 separa colaterales
      annual: annual ?? 0,
      hourly: hourly ?? hourlyFromAnnual(annual ?? 0) ?? 0,
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

// ==== Snapshot combinado para la UI (loanable + collateral) ====
export const fetchBinanceLoanSnapshot = async ({
  apiBase = DEFAULT_API_BASE,
  loanCoin,
  collateralCoin,
} = {}) => {
  ensureCredentials();

  const serverTime = await fetchServerTime(apiBase);
  const clockSkew = serverTime - Date.now();
  const requestOptions = { recvWindow: DEFAULT_RECV_WINDOW, timestamp: Date.now() + clockSkew };

  const [loanablePayload, collateralPayload] = await Promise.all([
    signedRequest(apiBase, '/sapi/v2/loan/flexible/loanable/data', loanCoin ? { loanCoin } : {}, requestOptions),
    signedRequest(apiBase, '/sapi/v2/loan/flexible/collateral/data', collateralCoin ? { collateralCoin } : {}, requestOptions),
  ]);

  const loanableRows = normalizeArray(loanablePayload);
  const collateralRows = normalizeArray(collateralPayload);
  const transformed = transformV2(loanableRows, collateralRows);

  return {
    source: 'binance_flexible_v2',
    fetchedAt: new Date().toISOString(),
    serverTime,
    clockSkew,
    rowCount: { loanable: loanableRows.length, collateral: collateralRows.length },
    config: transformed,
    metadata: {
      endpoints: {
        loanable: '/sapi/v2/loan/flexible/loanable/data',
        collateral: '/sapi/v2/loan/flexible/collateral/data',
      },
      requestParams: { loanCoin, collateralCoin },
    },
  };
};
