// server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  fetchBinanceLoanSnapshot,
  getOngoingLoans,
  getLoanableDataV2,
  getCollateralDataV2
} from './binanceClient.js';

import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

/* ===================== Paths para persistencia ===================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Seed manual dentro del repo (para primeras cargas / cooldown)
const SEED_PATHS = [
  path.join(__dirname, 'seed-snapshot.json'),
  path.resolve(process.cwd(), 'server/seed-snapshot.json'),
];
// Caché persistente efímera entre requests en Render
const TMP_PATH = '/tmp/binance-snapshot.json';

/* ========================== App & CORS ========================== */
const app = express();

const allow = (process.env.ALLOWED_ORIGINS || 'https://siberianok.github.io,https://nexo-dashboard.onrender.com')
  .split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server / curl
    const o = origin.replace(/\/$/, '');
    if (allow.includes(o)) return cb(null, true);
    return cb(new Error(`CORS: origin not allowed: ${origin}`));
  },
}));

/* ============================ Logs ============================ */
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} in ${Date.now() - t0}ms`);
  });
  next();
});

/* ======================== Health & Root ======================== */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now(), region: process.env.RENDER_REGION || null });
});

app.get('/', (_req, res) => {
  res.type('text/plain').send('nexo-dashboard backend: OK');
});

/* =================== Config interna (sin env) =================== */
const REQUEST_TIMEOUT_MS  = 12000;   // corte duro si Binance cuelga (12s)
const CACHE_TTL_MS        = 60000;   // consideramos fresco por 60s
const COOLDOWN_DEFAULT_MS = 120000;  // 2 min de freno si 429/418/-1003

// Estado en memoria
let CACHE = { ts: 0, data: null, source: null }; // source: 'live' | 'seed' | 'tmp'
let INFLIGHT = null;      // promesa en curso (dedupe)
let BAN_UNTIL_MS = 0;     // cooldown hasta epoch ms

/* ====================== Helpers utilitarios ====================== */
const withTimeout = (p, ms) =>
  Promise.race([ p, new Promise((_, rej) => setTimeout(() => rej(new Error(`upstream timeout after ${ms}ms`)), ms)) ]);

function noteRateLimit(err) {
  const txt = String(err?.message || '');
  const m = txt.match(/until\s+(\d{13})/i); // “IP banned until 1761117415585”
  BAN_UNTIL_MS = m ? Number(m[1]) : (Date.now() + COOLDOWN_DEFAULT_MS);
  console.warn(`[binance] rate limited. Cooldown hasta ${new Date(BAN_UNTIL_MS).toISOString()}`);
}

async function saveSnapshotToDisk(obj) {
  try { await writeFile(TMP_PATH, JSON.stringify(obj, null, 2), 'utf8'); }
  catch (e) { console.warn('[persist] no se pudo escribir /tmp snapshot:', e?.message || e); }
}

async function loadFrom(paths) {
  for (const p of paths) {
    try {
      const s = await readFile(p, 'utf8');
      const json = JSON.parse(s);
      if (json && typeof json === 'object') return json;
    } catch {}
  }
  return null;
}

async function ensureWarmCache() {
  // 1) intenta /tmp
  if (!CACHE.data) {
    const tmp = await loadFrom([TMP_PATH]);
    if (tmp) {
      CACHE = { ts: Date.now(), data: tmp, source: tmp.__source || 'tmp' };
      console.log('[cache] snapshot cargado desde /tmp');
      return true;
    }
  }
  // 2) intenta seed-snapshot.json dentro del repo
  if (!CACHE.data) {
    const seed = await loadFrom(SEED_PATHS);
    if (seed) {
      CACHE = { ts: Date.now(), data: seed, source: 'seed' };
      console.log('[cache] snapshot seed cargado');
      return true;
    }
  }
  return !!CACHE.data;
}

// decide si conviene refrescar ya mismo (en background)
function shouldRefresh(now) {
  if (now < BAN_UNTIL_MS) return false;              // en cooldown, no pegar
  if (INFLIGHT) return false;                         // ya hay fetch en curso
  if (!CACHE.data) return true;                       // sin cache → refrescar
  if (CACHE.source !== 'live') return true;           // seed/tmp → refrescar
  const age = now - CACHE.ts;
  return age > CACHE_TTL_MS * 0.6;                    // cache “maduro”
}

function backgroundRefresh() {
  if (INFLIGHT) return;
  if (Date.now() < BAN_UNTIL_MS) return; // en cooldown, no pegar
  INFLIGHT = (async () => {
    try {
      const fresh = await withTimeout(fetchBinanceLoanSnapshot({}), REQUEST_TIMEOUT_MS);
      CACHE = { ts: Date.now(), data: { ...fresh, __source: 'live' }, source: 'live' };
      await saveSnapshotToDisk(CACHE.data);
      console.log('[refresh] snapshot live actualizado');
    } catch (err) {
      const msg = String(err?.message || '');
      if (err?.code === -1003 || /IP banned|too much request weight|429/i.test(msg)) {
        noteRateLimit(err);
      } else if (/timeout/i.test(msg)) {
        console.warn('[refresh] timeout al actualizar snapshot');
      } else {
        console.warn('[refresh] error al actualizar snapshot:', msg);
      }
    } finally {
      INFLIGHT = null;
    }
  })();
}

/* =================== Admin (diagnóstico rápido) =================== */
app.get('/api/admin/state', (_req, res) => {
  res.json({
    hasCache: !!CACHE.data,
    cacheTs: CACHE.ts || null,
    ageMs: CACHE.ts ? Math.max(0, Date.now() - CACHE.ts) : null,
    cooldownUntil: BAN_UNTIL_MS || null,
    now: Date.now(),
    cacheSource: CACHE.source || null,
  });
});

/* ====================== Rutas principales ====================== */

// Siempre responde rápido: si hay seed/tmp/cache → 200 con {stale:true/false} y refresca en background.
app.get('/api/binance/loans', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const now = Date.now();

  // 0) Asegurar seed/tmp en memoria para primera respuesta inmediata
  await ensureWarmCache();

  // 0.1) Disparar refresh en background si corresponde (no bloquea)
  if (shouldRefresh(now)) backgroundRefresh();

  // 1) Si estamos en cooldown → servir cache/seed como stale (si existe)
  if (now < BAN_UNTIL_MS && CACHE.data) {
    return res.json({
      ...CACHE.data,
      cached: true,
      stale: true,
      ageMs: Math.max(0, now - CACHE.ts),
      cooldownUntil: BAN_UNTIL_MS,
    });
  }

  // 2) Si hay cache FRESCO → servir fresco
  if (CACHE.data && (now - CACHE.ts) < CACHE_TTL_MS) {
    return res.json({
      ...CACHE.data,
      cached: true,
      stale: false,
      ageMs: Math.max(0, now - CACHE.ts),
      cooldownUntil: now < BAN_UNTIL_MS ? BAN_UNTIL_MS : null,
    });
  }

  // 3) Si hay cache pero vencido → servir STALE (y ya dejamos el refresh en background)
  if (CACHE.data) {
    return res.json({
      ...CACHE.data,
      cached: true,
      stale: true,
      ageMs: Math.max(0, now - CACHE.ts),
      cooldownUntil: now < BAN_UNTIL_MS ? BAN_UNTIL_MS : null,
    });
  }

  // 4) No hay cache ni seed/tmp → intentar una vez (con timeout). Si falla: error claro (429/504)
  try {
    const fresh = await withTimeout(fetchBinanceLoanSnapshot({}), REQUEST_TIMEOUT_MS);
    CACHE = { ts: Date.now(), data: { ...fresh, __source: 'live' }, source: 'live' };
    await saveSnapshotToDisk(CACHE.data);
    return res.json({
      ...CACHE.data,
      cached: false,
      stale: false,
      ageMs: 0,
      cooldownUntil: null,
    });
  } catch (err) {
    const msg = String(err?.message || '');
    const code = err?.code;

    if (code === -1003 || /IP banned|too much request weight|429/i.test(msg)) {
      noteRateLimit(err);
      const retrySec = Math.max(1, Math.ceil((BAN_UNTIL_MS - Date.now()) / 1000));
      res.set('Retry-After', String(retrySec));
      return res.status(429).json({
        error: 'binance_rate_limited',
        message: msg,
        retryAfterSec: retrySec,
        cooldownUntil: BAN_UNTIL_MS,
      });
    }
    if (/timeout/i.test(msg)) {
      return res.status(504).json({ error: 'binance_timeout', message: msg });
    }
    return res.status(err?.status || 502).json({
      error: 'binance_sync_failed',
      message: msg || 'Unknown upstream error',
      binance: err?.binance ?? undefined,
    });
  }
});

// (Opcional) Posiciones activas — sin cache global
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

// (Opcional) Loanable directo — cuidado con rate limit
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

// (Opcional) Collateral directo
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

/* =================== Arranque del servidor =================== */
const port = process.env.PORT || 10000; // Render inyecta PORT
app.listen(port, () => console.log(`Servidor iniciado en http://localhost:${port}`));
