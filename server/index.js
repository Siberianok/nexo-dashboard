import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  getOngoingLoans,
  getLoanableDataV2,
  getCollateralDataV2,
  fetchBinanceLoanSnapshot,
} from './binanceClient.js';

const app = express();

// CORS: define origins permitidos (separa por comas si sumás otros)
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

// Healthcheck
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    region: process.env.RENDER_REGION || null,
  });
});

// Helper de errores con mensajes claros para tu UI
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

// Loans activos (v2)
app.get('/api/binance/loans', async (req, res) => {
  try {
    const { loanCoin, collateralCoin } = req.query;
    const data = await getOngoingLoans({ loanCoin, collateralCoin });
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// Loanable (tasas y límites) v2
app.get('/api/binance/loanable', async (req, res) => {
  try {
    const { loanCoin } = req.query;
    const data = await getLoanableDataV2({ loanCoin });
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// Collateral (LTVs y límites) v2
app.get('/api/binance/collateral', async (req, res) => {
  try {
    const { collateralCoin } = req.query;
    const data = await getCollateralDataV2({ collateralCoin });
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// Snapshot combinado para tu UI (loanable + collateral + transform)
app.get('/api/binance/snapshot', async (req, res) => {
  try {
    const { loanCoin, collateralCoin } = req.query;
    const data = await fetchBinanceLoanSnapshot({ loanCoin, collateralCoin });
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// Arranque
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Servidor iniciado en http://localhost:${port}`);
});
