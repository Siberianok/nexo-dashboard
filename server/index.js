import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { config as loadEnv } from 'dotenv';
import { MemoryCache } from './cache.js';
import { fetchBinanceLoanSnapshot } from './binanceClient.js';

loadEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const app = express();
const port = Number(process.env.PORT || 3000) || 3000;
const cacheTtlMs = Number(process.env.BINANCE_CACHE_TTL_MS || 300000) || 300000;
const cache = new MemoryCache(cacheTtlMs);

app.get('/api/binance/loans', async (req, res) => {
  const cacheKey = 'binance-loans';
  try {
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, cacheHit: true });
    }
    const snapshot = await fetchBinanceLoanSnapshot({
      loanCoin: req.query?.loanCoin,
      collateralCoin: req.query?.collateralCoin,
    });
    const payload = { ...snapshot, cacheHit: false };
    cache.set(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    if (error?.code === 'BINANCE_CREDENTIALS_MISSING') {
      return res.status(503).json({
        error: 'missing_credentials',
        message: 'Define BINANCE_API_KEY y BINANCE_API_SECRET para sincronizar los datos de Binance.',
      });
    }
    const status = error?.status && Number(error.status) >= 400 ? Number(error.status) : 502;
    return res.status(status).json({
      error: 'binance_sync_failed',
      message: error?.message || 'No se pudo sincronizar con Binance.',
    });
  }
});

app.use(express.static(ROOT_DIR));

app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.listen(port, () => {
  console.log(`Servidor iniciado en http://localhost:${port}`);
});
