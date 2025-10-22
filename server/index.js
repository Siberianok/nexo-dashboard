// server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  fetchBinanceLoanSnapshot, // snapshot de parámetros (APR/LTV/limits)
  getOngoingLoans,          // posiciones activas
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

// ===== Errores “lindos” =====
function handleError(res, err) {
  const msg = String(err?.message || 'Unknown error');

  // Rate limit / ban
  if (err?.code === -1003 || /IP banned|too much request weight|429/i.test(msg)) {
    return res.status(429).json({
      error: 'binance_rate_limited',
      message: msg,
    });
  }
  if (/restricted location/i.test(msg)) {
    return res.status(503).json({
      error: 'binance_sync_failed',
      message: 'Servicio no disponible desde la región del servidor.',
      hint: 'Despliega el backend en EU (Frankfurt) o Singapore.',
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

// ===== Cache & dedupe para snapshot =====
const SNAPSHOT_TIMEOUT_MS = Number(process.env.SNAPSHOT_TIMEOUT_MS || 12000) || 12000;
const SNAPSHOT_CACHE_TTL_MS = Number(process.env.SNAPSHOT_CACHE_TTL_MS || 60000) || 60000;

let SNAPSHOT_CACHE = { ts: 0, data: null, inflight: null };

const withTimeout = (promise, ms) =>
  Promise.race([ promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`upstream timeout after ${ms}ms`)), ms)) ]);

async function getSnapshotCached(params) {
  const now = Date.now();
  if (SNAPSHOT_CACHE.data && now - SNAPSHOT_CACHE.ts < SNAPSHOT_CACHE_TTL_MS) {
    return { ...SNAPSHOT_CACHE.data, cached: true };
  }
  if (SNAPSHOT_CACHE.inflight) {
    return SNAPSHOT_CACHE.inflight; // dedupe: reusar la misma promesa
  }
  SNAPSHOT_CACHE.inflight = (async () => {
    try {
      const data = await withTimeout(fetchBinanceLoanSnapshot(params), SNAPSHOT_TIMEOUT_MS);
      SNAPSHOT_CACHE = { ts: Date.now(), data, inflight: null };
      return data;
    } finally {
      SNAPSHOT_CACHE.inflight = null;
    }
  })();
  return SNAPSHOT_CACHE.inflight;
}

// ===== Rutas =====

// IMPORTANTE: ahora /api/binance/loans devuelve snapshot v2 (parámetros de mercado)
app.get('/api/binance/loans', async (req, res) => {
  try {
    const { loanCoin, collateralCoin } = req.query;
    const data = await getSnapshotCached({ loanCoin, collateralCoin });
    res.json(data);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/timeout/i.test(msg)) {
      return res.status(504).json({ error: 'binance_timeout', message: msg });
    }
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

// Snapshot explícito (igual que /loans)
app.get('/api/binance/snapshot', async (req, res) => {
  try {
    const { loanCoin, collateralCoin } = req.query;
    const data = await getSnapshotCached({ loanCoin, collateralCoin });
    res.json(data);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/timeout/i.test(msg)) {
      return res.status(504).json({ error: 'binance_timeout', message: msg });
    }
    handleError(res, err);
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Servidor iniciado en http://localhost:${port}`));
