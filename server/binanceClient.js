import crypto from 'crypto';
import fetch from 'node-fetch';

const DEFAULT_API_BASE = process.env.BINANCE_API_BASE || 'https://api.binance.com';
const DEFAULT_RECV_WINDOW = Number(process.env.BINANCE_RECV_WINDOW || 5000) || 5000;
const USE_VIP_ENDPOINT = String(process.env.BINANCE_USE_VIP_LOANABLE || '').toLowerCase() === 'true';
const API_KEY = process.env.BINANCE_API_KEY || '';
const API_SECRET = process.env.BINANCE_API_SECRET || '';

const parseNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const parseRatio = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num) > 1) {
    return num / 100;
  }
  return num;
};

const annualize = (rate) => (rate == null ? null : rate * 365);
const hourlyFromAnnual = (annual) => (annual == null ? null : annual / (365 * 24));

const normalizeArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload && typeof payload === 'object') {
    return Object.values(payload);
  }
  return [];
};

const createSignature = (payload, secret) => {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
};

const ensureCredentials = () => {
  if (!API_KEY || !API_SECRET) {
    const error = new Error('Binance API credentials are missing.');
    error.code = 'BINANCE_CREDENTIALS_MISSING';
    throw error;
  }
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    let details = '';
    try {
      const payload = await response.json();
      details = payload?.msg || payload?.message || JSON.stringify(payload);
    } catch (error) {
      details = await response.text();
    }
    const error = new Error(details || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

const fetchServerTime = async (apiBase) => {
  const data = await fetchJson(`${apiBase}/api/v3/time`);
  const serverTime = Number(data?.serverTime);
  if (!Number.isFinite(serverTime)) {
    throw new Error('Invalid server time response from Binance.');
  }
  return serverTime;
};

const signedRequest = async (apiBase, path, params = {}, { recvWindow = DEFAULT_RECV_WINDOW } = {}) => {
  ensureCredentials();
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.append(key, value);
  });
  query.append('timestamp', `${Date.now()}`);
  if (recvWindow) {
    query.append('recvWindow', `${recvWindow}`);
  }
  const signature = createSignature(query.toString(), API_SECRET);
  query.append('signature', signature);
  const url = `${apiBase}${path}?${query.toString()}`;
  return fetchJson(url, {
    method: 'GET',
    headers: {
      'X-MBX-APIKEY': API_KEY,
    },
  });
};

const transformLoanable = (rows = []) => {
  const ltvByTicker = {};
  const borrowRates = {};
  const loanLedger = {};

  rows.forEach((row) => {
    const collateral = String(row?.collateralCoin || row?.collateralAsset || '').toUpperCase();
    const loanCoin = String(row?.loanCoin || row?.loanAsset || '').toUpperCase();
    if (!collateral || !loanCoin) return;

    const initialLtv = parseRatio(row?.initialLTV ?? row?.initLTV ?? row?.initialLtv);
    const marginCallLtv = parseRatio(row?.marginCallLTV ?? row?.marginCall ?? row?.marginCallLtv);
    const liquidationLtv = parseRatio(row?.liquidationLTV ?? row?.liquidationLtv ?? row?.liquidationLTVPercent);
    const yearlyRate = parseRatio(row?.yearlyInterestRate ?? row?.yearRate ?? row?.annualInterestRate);
    const dailyRate = parseRatio(row?.dailyInterestRate ?? row?.dayRate ?? row?.dailyRate);
    const hourlyRate = parseRatio(row?.hourlyInterestRate ?? row?.hourRate ?? row?.hourlyRate);
    const vipYearlyRate = parseRatio(row?.vipYearlyInterestRate ?? row?.vipYearRate ?? row?.vipAnnualInterestRate);
    const vipDailyRate = parseRatio(row?.vipDailyInterestRate ?? row?.vipDayRate ?? row?.vipBorrowRate);

    const annual = yearlyRate ?? annualize(dailyRate ?? (hourlyRate != null ? hourlyRate * 24 : null));
    const hourly = hourlyRate ?? (dailyRate != null ? dailyRate / 24 : hourlyFromAnnual(annual));
    const netAnnual = vipYearlyRate ?? annualize(vipDailyRate);
    const adjustmentAnnual = annual != null && netAnnual != null ? Math.max(annual - netAnnual, 0) : null;

    if (initialLtv != null) {
      const prev = ltvByTicker[collateral];
      ltvByTicker[collateral] = prev == null ? initialLtv : Math.max(prev, initialLtv);
    }

    borrowRates[loanCoin] = {
      label: `${loanCoin}`,
      loanAsset: loanCoin,
      collateralAsset: collateral,
      annual: annual ?? 0,
      hourly: hourly ?? hourlyFromAnnual(annual ?? 0) ?? 0,
      netAnnual: netAnnual ?? annual ?? 0,
      adjustmentAnnual: adjustmentAnnual ?? 0,
      vipLevel: row?.vipLevel,
      limitNote: row?.loanLimitNote || 'Datos sincronizados desde Binance Loans',
    };

    loanLedger[loanCoin] = {
      collateralAsset: collateral,
      loanAsset: loanCoin,
      initialLtv: initialLtv ?? null,
      marginCallLtv: marginCallLtv ?? null,
      liquidationLtv: liquidationLtv ?? null,
      collateralPrice: parseNumber(row?.collateralPrice ?? row?.assetPrice ?? row?.collateralCoinPrice),
      maxLoanAmount: parseNumber(row?.maxLimit ?? row?.loanableAmount ?? row?.maxLoanableAmount),
      minLoanAmount: parseNumber(row?.minLimit ?? row?.minLoanableAmount),
      referenceDailyRate: dailyRate ?? null,
      referenceYearlyRate: yearlyRate ?? null,
    };
  });

  return {
    ltvByTicker,
    borrowRates,
    loanLedger,
  };
};

export const fetchBinanceLoanSnapshot = async ({ apiBase = DEFAULT_API_BASE, loanCoin, collateralCoin } = {}) => {
  ensureCredentials();
  const serverTime = await fetchServerTime(apiBase);
  const originalNow = Date.now();
  const clockSkew = serverTime - originalNow;
  const path = USE_VIP_ENDPOINT ? '/sapi/v1/loan/vip/loanable/data' : '/sapi/v1/loan/loanable/data';
  const params = {};
  if (loanCoin) params.loanCoin = loanCoin;
  if (collateralCoin) params.collateralCoin = collateralCoin;

  const payload = await signedRequest(apiBase, path, params, { recvWindow: DEFAULT_RECV_WINDOW });
  const rows = normalizeArray(payload);
  const transformed = transformLoanable(rows);

  return {
    source: USE_VIP_ENDPOINT ? 'binance_vip_loanable' : 'binance_standard_loanable',
    fetchedAt: new Date().toISOString(),
    serverTime,
    clockSkew,
    rowCount: rows.length,
    config: transformed,
    metadata: {
      endpoint: path,
      requestParams: params,
    },
    raw: {
      loanable: rows,
    },
  };
};
