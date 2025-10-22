// server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  fetchBinanceLoanSnapshot, // snapshot de parámetros (APR/LTV/limits)
  getOngoingLoans,
  getLoanableDataV2,
  getCollateralDataV2
} from './binanceClient.js';

const app = express();

// ===== CORS =====
const allow = (process.env.ALLOWED_ORIGINS || 'https://siberianok.github.io,https://nexo-dashboard.onrender.com')
  .split(',')
  .map(s => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl / server-to-server
    const o = origin.replace(/\/$/, '');
    if (allow.includes(o)) return cb(null, true);
    return cb(new Error(`CORS: origin not allowed: ${origin}`));
  },
}));

// ===== Logging simple =====
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} in ${Date.now() - t0}ms`));
  next();
});

// ===== Health =====
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now(), region: process.env.RENDER_REGION || null });
});

// ===== Manejo de errores con mensajes claros =====
function handleError(res, err) {
  const msg = String(err?.message || 'Unknown error');

  if (err?.code === -1003 || /IP banned|too much request weight|429/i.test(msg)) {
    // Rate limit
    return res.status(429).json({ error: 'binance_rate_limited', message: msg });
  }
  if (/restricted location/i.test(msg)) {
    return res.status(503).json({
      error: 'binance_sync_failed',
      message: 'Servicio no disponible desde la región del servidor.',
    });
  }
  if (/deprecated/i.test(msg)) {
    return res.status(410).json({
      error: 'binance_sync_failed',
      message: 'Endpoint retirado por Binance. Usa SAPI v2.',
    });
  }
  return res.status(err?.status || 502).json({ error: 'binance_sync_failed', message: msg, binance: err?.binance ?? undefined });
}

// ===== Cache + Dedupe + Cooldown =====
const SNAPSHOT_TIMEOUT_MS     = Number(process.env.SNAPSHOT_TIMEOUT_MS || 12000)   || 12000;
const SNAPSHOT_CACHE_TTL_MS   = Number(process.env.SNAPSHOT_CACHE_TTL_MS || 60000) || 60000; // 60s
const RATE_LIMIT_COOLDOWN_MS  = Number(process.env.RATE_LIMIT_COOLDOWN_MS || 120000) || 120000; // 2m

const CACHE = new Map(); // key -> { ts, data, inflight }
let BAN_UNTIL_MS = 0;

const withTimeout = (promise, ms) =>
  Promise.race([ promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`upstream timeout after ${ms}ms`)), ms)) ]);

const cacheKey = (params) => JSON.stringify({ loanCoin: params?.loanCoin || null, collateralCoin: params?.collateralCoin || null });

function noteRateLimit(err) {
  const txt = String(err?.message || '');
  // Intenta extraer "IP banned until 1761107759142"
  const m = txt.match(/until\s+(\d{13})/i);
  if (m) {
    BAN_UNTIL_MS = Number(m[1]);
  } else {
    BAN_UNTIL_MS = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  }
  console.warn(`[binance] rate limited. Cooldown hasta ${new Date(BAN_UNTIL_MS).toISOString()}`);
}

async function getSnapshotCached(params) {
  const key = cacheKey(params);
  const now = Date.now();
  const rec = CACHE.get(key);

  // Si estamos en cooldown, servimos stale si existe; si no, devolvemos 429
  if (now < BAN_UNTIL_MS) {
    if (rec?.data) return { ...rec.data, cached: true, stale: true, retryAfterMs: BAN_UNTIL_MS - now };
    const e = new Error(`temporarily rate limited; retry after ${BAN_UNTIL_MS - now}ms`);
    e.status = 429;
    e.code = -1003;
    throw e;
  }

  // Sirve cache fresco
  if (rec?.data && now - rec.ts < SNAPSHOT_CACHE_TTL_MS) {
    return { ...rec.data, cached: true };
  }

  // Dedupe: si ya hay una request en curso, la reusamos
  if (rec?.inflight) return rec.inflight;

  const next = rec || { ts: 0, data: null, inflight: null };
  next.inflight = (async () => {
    try {
      const data = await withTimeout(fetchBinanceLoanSnapshot(params), SNAPSHOT_TIMEOUT_MS);
      next.ts = Date.now();
      next.data = data;
      CACHE.set(key, next);
      return data;
    } catch (err) {
      if (err?.code === -1003 || /IP banned|too much request weight|429/i.test(String(err?.message || ''))) {
        noteRateLimit(err);
      }
      throw err;
    } finally {
      next.inflight = null;
    }
  })();
  CACHE.set(key, next);
  return next.inflight;
}

// ===== Rutas =====

// IMPORTANTE: ahora /api/binance/loans devuelve el snapshot v2 (parámetros de mercado)
app.get('/api/binance/loans', async (req, res) => {
  try {
    const { loanCoin, collateralCoin } = req.query;
    const data = await getSnapshotCached({ loanCoin, collateralCoin });
    res.json(data);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/timeout/i.test(msg)) return res.status(504).json({ error: 'binance_timeout', message: msg });
    handleError(res, err);
  }
});

// Posiciones activas (ongoing orders v2)
app.get('/api/binance/positions', async (req, res) => {
  try {
    const { loanCoin, collateralCoin } = req.query;
    const rows = await getOngoingLoans({ loanCoin, collateralCoin });
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// Loanable
app.get('/api/binance/loanable', async (req, res) => {
  try {
    const { loanCoin } = req.query;
    const data = await getLoanableDataV2({ loanCoin });
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// Collateral
app.get('/api/binance/collateral', async (req, res) => {
  try {
    const { collateralCoin } = req.query;
    const data = await getCollateralDataV2({ collateralCoin });
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// Snapshot explícito (idéntico a /loans)
app.get('/api/binance/snapshot', async (req, res) => {
  try {
    const { loanCoin, collateralCoin } = req.query;
    const data = await getSnapshotCached({ loanCoin, collateralCoin });
    res.json(data);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/timeout/i.test(msg)) return res.status(504).json({ error: 'binance_timeout', message: msg });
    handleError(res, err);
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Servidor iniciado en http://localhost:${port}`));
