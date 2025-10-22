import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  syncServerTime,
  getOngoingLoans,
  getBorrowHistory,
  getLoanableData,
  getCollateralData,
} from './binanceClient.js';

const app = express();

// Allowlist CORS desde env (separa por comas si agregás más)
const allow = (process.env.ALLOWED_ORIGINS || 'https://siberianok.github.io')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl/local
      if (allow.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin not allowed: ${origin}`));
    },
  })
);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    region: process.env.RENDER_REGION || null,
  });
});

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

app.get('/api/binance/loans', async (_req, res) => {
  try {
    const data = await getOngoingLoans();
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/binance/loans/history', async (_req, res) => {
  try {
    const data = await getBorrowHistory();
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/binance/loanable', async (_req, res) => {
  try {
    const data = await getLoanableData();
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/binance/collateral', async (_req, res) => {
  try {
    const data = await getCollateralData();
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

const port = process.env.PORT || 10000;
syncServerTime().catch(() => {});
app.listen(port, () => {
  console.log(`Servidor iniciado en http://localhost:${port}`);
});
