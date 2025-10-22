// server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  fetchBinanceLoanSnapshot, // snapshot de parámetros (APR/LTV/limits) — hace 2 llamadas a Binance
  getOngoingLoans,
  getLoanableDataV2,
  getCollateralDataV2
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

/* ============ C O N F I G  B A C K E N D ============ */
// Refrescamos snapshot en background y servimos caché a los clientes
const REFRESH_INTERVAL_MS    = Number(process.env.REFRESH_INTERVAL_MS    || 60000)  || 60000;  // 60s
const SNAPSHOT_CACHE_TTL_MS  = Number(process.env.SNAPSHOT_CACHE_TTL_MS  || 120000) || 120000; // 120s “fresco”
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.RATE_LIMIT_COOLDOWN_MS || 180000) || 180000; // 3 min
const SNAPSHOT_TIMEOUT_MS    = Number(process.env.SNAPSHOT_TIMEOUT_MS    || 12000)  || 12000;  // corte total

// Estado del snapshot (una única “key”, si luego querés por loanCoin/collateralCoin lo generalizamos)
let SNAPSHOT = {
  ts: 0,            // timestamp última actualización OK
  data: null,       // último snapshot
  inflight: null,   // promesa en vuelo
  cooldownUntil: 0, // epoch en ms si estamos rate-limited/banned
};

// util: carrera con timeout
const withTimeout = (p, ms) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`upstream timeout after ${ms}ms`)), ms)),
  ]);

// si recibimos -1003/429, fijamos cooldown
function noteRateLimit(err) {
  const txt = String(err?.message || '');
  const m = txt.match(/until\s+(\d{13})/i); // “IP banned until 1761112376252”
  if (m) {
    SNAPSHOT.cooldownUntil = Number(m[1]);
  } else {
    SNAPSHOT.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  }
  console.warn(`[binance] rate limited. Cooldown hasta ${new Date(SNAPSHOT.cooldownUntil).toISOString()}`);
}

// refresco “seguro” del snapshot (no bloquea respuestas)
async function refreshSnapshotSafe() {
  const now = Date.now();
  if (now < SNAPSHOT.cooldownUntil) return; // en cooldown, no peguemos a Binance

  if (SNAPSHOT.inflight) {
    // ya hay una en curso; dejemos que termine
    return SNAPSHOT.inflight;
  }

  SNAPSHOT.inflight = (async () => {
    try {
      const data = await withTimeout(fetchBinanceLoanSnapshot({}), SNAPSHOT_TIMEOUT_MS);
      SNAPSHOT.data = data;
      SNAPSHOT.ts = Date.now();
      return data;
    } catch (err) {
      // -1003/429 → cooldown
      if (err?.code === -1003 || /IP banned|too much request weight|429/i.test(String(err?.message || ''))) {
        noteRateLimit(err);
      }
      throw err;
    } finally {
      SNAPSHOT.inflight = null;
    }
  })();

  try {
    return await SNAPSHOT.inflight;
  } catch {
    // errores se registran arriba; no re-lanzamos aquí para no cortar el scheduler
    return null;
  }
}

// scheduler de refresco en background (con un poco de jitter para no pegar “en el minuto”)
function startScheduler() {
  const jitter = Math.floor(Math.random() * 5000); // 0–5s
  setTimeout(() => {
    refreshSnapshotSafe().finally(() => {
      startScheduler(); // reprograma
    });
  }, REFRESH_INTERVAL_MS + jitter).unref?.();
}

// arranque: calentamos caché una vez (no bloqueante) y lanzamos scheduler
refreshSnapshotSafe().finally(() => startScheduler());

/* ================ M A N E J O  E R R O R E S =============== */
function handleError(res, err) {
  const msg = String(err?.message || 'Unknown error');

  if (err?.code === -1003 || /IP banned|too much request weight|429/i.test(msg)) {
    const retrySec = Math.max(1, Math.ceil((SNAPSHOT.cooldownUntil - Date.now()) / 1000));
    res.set('Retry-After', String(retrySec));
    return res.status(429).json({ error: 'binance_rate_limited', message: msg, retryAfterSec: retrySec, cooldownUntil: SNAPSHOT.cooldownUntil });
  }
  if (/restricted location/i.test(msg)) {
    return res.status(503).json({ error: 'binance_sync_failed', message: 'Servicio no disponible desde la región del servidor.' });
  }
  if (/deprecated/i.test(msg)) {
    return res.status(410).json({ error: 'binance_sync_failed', message: 'Endpoint retirado por Binance. Usa SAPI v2.' });
  }
  return res.status(err?.status || 502).json({ error: 'binance_sync_failed', message: msg, binance: err?.binance ?? undefined });
}

/* ==================== R U T A S  A P I ==================== */

// /loans ahora SIEMPRE sirve desde caché; si está “stale” lo indica.
// Nunca bloquea al usuario esperando a Binance.
app.get('/api/binance/loans', async (_req, res) => {
  res.set('Cache-Control', 'no-store');

  const now = Date.now();
  const ageMs = SNAPSHOT.ts ? (now - SNAPSHOT.ts) : null;
  const nextRefreshInMs = Math.max(0, (SNAPSHOT.ts + REFRESH_INTERVAL_MS) - now);

  // si estamos en cooldown y hay caché → servimos stale con 200
  if (now < SNAPSHOT.cooldownUntil && SNAPSHOT.data) {
    return res.json({
      ...SNAPSHOT.data,
      cached: true,
      stale: true,
      ageMs,
      nextRefreshInMs,
      cooldownUntil: SNAPSHOT.cooldownUntil,
    });
  }

  // si hay caché “fresco” => sirve
  if (SNAPSHOT.data && now - SNAPSHOT.ts < SNAPSHOT_CACHE_TTL_MS) {
    return res.json({
      ...SNAPSHOT.data,
      cached: true,
      stale: false,
      ageMs,
      nextRefreshInMs,
      cooldownUntil: SNAPSHOT.cooldownUntil || null,
    });
  }

  // no hay caché fresco: lanzamos refresh en background (si no está ya)
  refreshSnapshotSafe().catch(() => {});

  // si existe algún snapshot anterior aunque sea viejo → lo devolvemos como stale
  if (SNAPSHOT.data) {
    return res.json({
      ...SNAPSHOT.data,
      cached: true,
      stale: true,
      ageMs,
      nextRefreshInMs,
      cooldownUntil: SNAPSHOT.cooldownUntil || null,
    });
  }

  // primera vez y sin datos: si hay cooldown → 429 con Retry-After
  if (now < SNAPSHOT.cooldownUntil) {
    const retrySec = Math.max(1, Math.ceil((SNAPSHOT.cooldownUntil - now) / 1000));
    res.set('Retry-After', String(retrySec));
    return res.status(429).json({
      error: 'binance_rate_limited',
      message: 'Temporarily rate limited; warmup pending.',
      retryAfterSec: retrySec,
      cooldownUntil: SNAPSHOT.cooldownUntil,
    });
  }

  // primera vez, sin cooldown → intentamos un fetch directo con timeout
  try {
    const data = await withTimeout(fetchBinanceLoanSnapshot({}), SNAPSHOT_TIMEOUT_MS);
    SNAPSHOT.data = data;
    SNAPSHOT.ts = Date.now();
    return res.json({
      ...data,
      cached: false,
      stale: false,
      ageMs: 0,
      nextRefreshInMs: REFRESH_INTERVAL_MS,
      cooldownUntil: null,
    });
  } catch (err) {
    if (err?.code === -1003 || /IP banned|too much request weight|429/i.test(String(err?.message || ''))) {
      noteRateLimit(err);
      const retrySec = Math.max(1, Math.ceil((SNAPSHOT.cooldownUntil - Date.now()) / 1000));
      res.set('Retry-After', String(retrySec));
      return res.status(429).json({ error: 'binance_rate_limited', message: String(err.message || ''), retryAfterSec: retrySec, cooldownUntil: SNAPSHOT.cooldownUntil });
    }
    return handleError(res, err);
  }
});

// Posiciones activas (si las necesitás, recomendable también cachearlas con TTL corto)
app.get('/api/binance/positions', async (req, res) => {
  try {
    const { loanCoin, collateralCoin } = req.query;
    const rows = await getOngoingLoans({ loanCoin, collateralCoin });
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// Loanable directo (sin cache global; úsalo con cuidado)
app.get('/api/binance/loanable', async (req, res) => {
  try {
    const { loanCoin } = req.query;
    const data = await getLoanableDataV2({ loanCoin });
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// Collateral directo
app.get('/api/binance/collateral', async (req, res) => {
  try {
    const { collateralCoin } = req.query;
    const data = await getCollateralDataV2({ collateralCoin });
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// Alias explícito del snapshot
app.get('/api/binance/snapshot', async (req, res) => {
  return app._router.handle({ ...req, url: '/api/binance/loans' }, res, () => {});
});

/* ============== A R R A N Q U E  S E R V I D O R ============== */
const port = process.env.PORT || 10000; // Render inyecta PORT
app.listen(port, () => console.log(`Servidor iniciado en http://localhost:${port}`));
