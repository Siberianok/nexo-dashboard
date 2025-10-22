// server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  fetchBinanceLoanSnapshot, // snapshot: APR/LTV/limits (v2) - usa 2 endpoints de Binance
  getOngoingLoans,          // posiciones activas (opcional)
  getLoanableDataV2,        // tasas/límites por asset a pedir (opcional)
  getCollateralDataV2       // LTVs por colateral (opcional)
} from './binanceClient.js';

const app = express();

/* ===================== C O R S ===================== */
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

/* ============== L O G S  S I M P L E S ============== */
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} in ${Date.now() - t0}ms`);
  });
  next();
});

/* ================ H E A L T H C H E C K =============== */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now(), region: process.env.RENDER_REGION || null });
});

/* ================== R O O T  (evita 404 en HEAD /) ================== */
app.get('/', (_req, res) => {
  res.type('text/plain').send('nexo-dashboard backend: OK');
});

/* ======= Config interna (sin tocar env) para loans/snapshot ======= */
const REQUEST_TIMEOUT_MS   = 12000;   // corte duro si Binance cuelga (12s)
const CACHE_TTL_MS         = 60000;   // snapshot fresco por 60s
const COOLDOWN_DEFAULT_MS  = 120000;  // 2 min de freno si hay 429/-1003

// Estado en memoria
let CACHE = { ts: 0, data: null };
let INFLIGHT = null;      // promesa en curso (dedupe)
let BAN_UNTIL_MS = 0;     // cooldown por rate limit

// util: carrera con timeout
const withTimeout = (p, ms) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`upstream timeout after ${ms}ms`)), ms)),
  ]);

// marca cooldown cuando Binance tira -1003/429
function noteRateLimit(err) {
  const txt = String(err?.message || '');
  const m = txt.match(/until\s+(\d{13})/i); // “IP banned until 1761112376252”
  if (m) {
    BAN_UNTIL_MS = Number(m[1]);
  } else {
    BAN_UNTIL_MS = Date.now() + COOLDOWN_DEFAULT_MS;
  }
  console.warn(`[binance] rate limited. Cooldown hasta ${new Date(BAN_UNTIL_MS).toISOString()}`);
}

/* ==================== H A N D L E R S  A P I ==================== */

// /api/binance/loans — sirve snapshot con cache+dedupe+cooldown. Nunca 502 opaco.
app.get('/api/binance/loans', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const now = Date.now();

  try {
    // 1) Si estamos en cooldown y hay cache → servir STALE (200)
    if (now < BAN_UNTIL_MS && CACHE.data) {
      return res.json({
        ...CACHE.data,
        cached: true,
        stale: true,
        ageMs: now - CACHE.ts,
        cooldownUntil: BAN_UNTIL_MS,
      });
    }

    // 2) Si el cache es fresco → servir FRESCO (200)
    if (CACHE.data && now - CACHE.ts < CACHE_TTL_MS) {
      return res.json({
        ...CACHE.data,
        cached: true,
        stale: false,
        ageMs: now - CACHE.ts,
        cooldownUntil: now < BAN_UNTIL_MS ? BAN_UNTIL_MS : null,
      });
    }

    // 3) Deduplicación: si ya hay una fetch en curso, esperar esa
    if (INFLIGHT) {
      const data = await INFLIGHT;
      return res.json({
        ...data,
        cached: true,
        stale: false,
        ageMs: Date.now() - CACHE.ts,
        cooldownUntil: now < BAN_UNTIL_MS ? BAN_UNTIL_MS : null,
      });
    }

    // 4) Hacer fetch a Binance con timeout y actualizar cache
    INFLIGHT = (async () => {
      const data = await withTimeout(fetchBinanceLoanSnapshot({}), REQUEST_TIMEOUT_MS);
      CACHE = { ts: Date.now(), data };
      return data;
    })();

    const fresh = await INFLIGHT;
    INFLIGHT = null;

    return res.json({
      ...fresh,
      cached: false,
      stale: false,
      ageMs: 0,
      cooldownUntil: null,
    });

  } catch (err) {
    INFLIGHT = null; // limpia dedupe si falló
    const msg = String(err?.message || '');
    const code = err?.code;

    console.error('[loans] error:', { code, msg, status: err?.status });

    // Timeout claro → 504
    if (/timeout/i.test(msg)) {
      return res.status(504).json({ error: 'binance_timeout', message: msg });
    }

    // Rate limit / ban → activar cooldown y, si hay cache, servir STALE; si no, 429 con Retry-After
    if (code === -1003 || /IP banned|too much request weight|429/i.test(msg)) {
      noteRateLimit(err);
      if (CACHE.data) {
        return res.json({
          ...CACHE.data,
          cached: true,
          stale: true,
          ageMs: Date.now() - CACHE.ts,
          cooldownUntil: BAN_UNTIL_MS,
        });
      }
      const retrySec = Math.max(1, Math.ceil((BAN_UNTIL_MS - Date.now()) / 1000));
      res.set('Retry-After', String(retrySec));
      return res.status(429).json({
        error: 'binance_rate_limited',
        message: msg,
        retryAfterSec: retrySec,
        cooldownUntil: BAN_UNTIL_MS,
      });
    }

    // Otros errores de Binance → usar status si viene; si no, 502 con mensaje (no opaco)
    return res.status(err?.status || 502).json({
      error: 'binance_sync_failed',
      message: msg || 'Unknown upstream error',
      binance: err?.binance ?? undefined,
    });
  }
});

// Posiciones activas (opcional; sin cache global)
app.get('/api/binance/positions', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { loanCoin, collateralCoin } = req.query;
    const rows = await withTimeout(getOngoingLoans({ loanCoin, collateralCoin }), REQUEST_TIMEOUT_MS);
    res.json(rows);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/timeout/i.test(msg)) return res.status(504).json({ error: 'binance_timeout', message: msg });
    return res.status(err?.status || 502).json({ error: 'binance_sync_failed', message: msg });
  }
});

// Loanable directo (opcional; úsalo con cuidado por rate limit)
app.get('/api/binance/loanable', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { loanCoin } = req.query;
    const data = await withTimeout(getLoanableDataV2({ loanCoin }), REQUEST_TIMEOUT_MS);
    res.json(data);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/timeout/i.test(msg)) return res.status(504).json({ error: 'binance_timeout', message: msg });
    return res.status(err?.status || 502).json({ error: 'binance_sync_failed', message: msg });
  }
});

// Collateral directo (opcional)
app.get('/api/binance/collateral', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { collateralCoin } = req.query;
    const data = await withTimeout(getCollateralDataV2({ collateralCoin }), REQUEST_TIMEOUT_MS);
    res.json(data);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/timeout/i.test(msg)) return res.status(504).json({ error: 'binance_timeout', message: msg });
    return res.status(err?.status || 502).json({ error: 'binance_sync_failed', message: msg });
  }
});

// Alias explícito del snapshot (mismo handler que /loans)
app.get('/api/binance/snapshot', (req, res, next) => {
  req.url = '/api/binance/loans';
  app._router.handle(req, res, next);
});

/* ============== A R R A N Q U E  S E R V I D O R ============== */
const port = process.env.PORT || 10000; // Render inyecta PORT
app.listen(port, () => console.log(`Servidor iniciado en http://localhost:${port}`));
