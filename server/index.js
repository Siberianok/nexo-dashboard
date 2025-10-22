// server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  fetchBinanceLoanSnapshot, // snapshot combinado (loanable + collateral) para la UI
  getOngoingLoans,          // posiciones activas (ongoing orders v2)
  getLoanableDataV2,        // tasas/límites por asset a pedir
  getCollateralDataV2       // LTVs/límites por colateral
} from './binanceClient.js';

const app = express();

// ===== CORS (lee ALLOWED_ORIGINS, separado por comas) =====
const allow = (process.env.ALLOWED_ORIGINS || 'https://siberianok.github.io,https://nexo-dashboard.onrender.com')
  .split(',')
  .map(s => s.trim().replace(/\/$/, '')) // normaliza (sin barra final)
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl / server-to-server
    const o = origin.replace(/\/$/, '');
    if (allow.includes(o)) return cb(null, true);
    return cb(new Error(`CORS: origin not allowed: ${origin}`));
  },
}));

// ===== Logging simple de latencias =====
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} in ${Date.now() - t0}ms`);
  });
  next();
});

// ===== Healthcheck =====
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    region: process.env.RENDER_REGION || null,
  });
});

// ===== Manejo estándar de errores de Binance =====
function handleError(res, err) {
  const msg = String(err?.message || 'Unknown error');

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
      hint: 'Actualiza a /sapi/v2/loan/flexible/... en el cliente/servidor.',
    });
  }
  return res.status(err?.status || 502).json({
    error: 'binance_sync_failed',
    message: msg,
    binance: err?.binance ?? undefined,
  });
}

// ===== helper timeout total p/ snapshot =====
const SNAPSHOT_TIMEOUT_MS = Number(process.env.SNAPSHOT_TIMEOUT_MS || 12000) || 12000;
const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`upstream timeout after ${ms}ms`)), ms)),
  ]);

// ===== Rutas de negocio =====

// IMPORTANTE: ahora /api/binance/loans devuelve el SNAPSHOT v2 (parámetros de mercado)
// para que el simulador cuadre APR/LTV/limits como la web de Binance.
app.get('/api/binance/loans', async (req, res) => {
  try {
    const { loanCoin, collateralCoin } = req.query;
    const data = await withTimeout(
      fetchBinanceLoanSnapshot({ loanCoin, collateralCoin }),
      SNAPSHOT_TIMEOUT_MS
    );
    res.json(data);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/timeout/i.test(msg)) {
      return res.status(504).json({ error: 'binance_timeout', message: msg });
    }
    handleError(res, err);
  }
});

// Posiciones activas (ongoing orders v2) — deuda/LTV actual
app.get('/api/binance/positions', async (req, res) => {
  try {
    const { loanCoin, collateralCoin } = req.query;
    const rows = await getOngoingLoans({ loanCoin, collateralCoin });
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// Loanable (tasas/límites por asset a pedir)
app.get('/api/binance/loanable', async (req, res) => {
  try {
    const { loanCoin } = req.query;
    const data = await getLoanableDataV2({ loanCoin });
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// Collateral (LTVs/límites por colateral)
app.get('/api/binance/collateral', async (req, res) => {
  try {
    const { collateralCoin } = req.query;
    const data = await getCollateralDataV2({ collateralCoin });
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// Snapshot explícito (idéntico a /api/binance/loans; queda por claridad)
app.get('/api/binance/snapshot', async (req, res) => {
  try {
    const { loanCoin, collateralCoin } = req.query;
    const data = await withTimeout(
      fetchBinanceLoanSnapshot({ loanCoin, collateralCoin }),
      SNAPSHOT_TIMEOUT_MS
    );
    res.json(data);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/timeout/i.test(msg)) {
      return res.status(504).json({ error: 'binance_timeout', message: msg });
    }
    handleError(res, err);
  }
});

// ===== Arranque del servidor =====
const port = process.env.PORT || 10000; // Render inyecta PORT
app.listen(port, () => {
  console.log(`Servidor iniciado en http://localhost:${port}`);
});
