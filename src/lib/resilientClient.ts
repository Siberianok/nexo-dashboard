// @ts-nocheck
export const safeStorage = (() => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const storage = window.localStorage;
    const probeKey = '__nexoSimStorageProbe__';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch (_) {
    return null;
  }
})();

export const LOG_PREFIX_FALLBACK = '[nexo-sim]';

export const createResilientApiClient = ({
  fetchFn,
  logger = console,
  namespace = 'nexoSimApi',
  logPrefix = LOG_PREFIX_FALLBACK,
}) => {
  if (typeof fetchFn !== 'function') {
    throw new Error('fetchFn es requerido para crear el cliente resiliente.');
  }
  const storage = safeStorage;
  const storagePrefix = `${namespace}:`;
  const readCache = (key) => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(`${storagePrefix}${String(key)}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      logger?.warn?.(logPrefix, 'No se pudo leer la cache local.', error);
      return null;
    }
  };
  const writeCache = (key, entry) => {
    if (!storage) return;
    try {
      storage.setItem(`${storagePrefix}${String(key)}`, JSON.stringify(entry));
    } catch (error) {
      logger?.warn?.(logPrefix, 'No se pudo persistir la cache local.', error);
    }
  };
  const removeCache = (key) => {
    if (!storage) return;
    try {
      storage.removeItem(`${storagePrefix}${String(key)}`);
    } catch (_) {}
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const attachMeta = (payload, meta) => {
    if (payload && typeof payload === 'object') {
      Object.defineProperty(payload, '__cacheMeta', {
        value: Object.freeze(meta),
        enumerable: false,
        configurable: true,
      });
    }
    return payload;
  };
  const defaultRetryDecider = ({ error, response }) => {
    if (response) {
      if (response.status === 429 || response.status === 408 || response.status === 425) return true;
      if (response.status >= 500) return true;
    }
    if (error) {
      if (error.code === 'ETIMEDOUT' || error.name === 'AbortError') return true;
      if (!response) return true;
    }
    return false;
  };
  const requestJson = async (url, options = {}, config = {}) => {
    const {
      cacheKey: providedCacheKey,
      cacheTtlMs = 0,
      staleTtlMs = cacheTtlMs,
      retries = 2,
      retryDelayMs = 500,
      backoffFactor = 2,
      timeoutMs = null,
      forceRefresh = false,
      retryDecider,
      onCacheHit,
    } = config || {};
    const method = options && options.method ? String(options.method).toUpperCase() : 'GET';
    const effectiveCacheKey = providedCacheKey || ((cacheTtlMs || staleTtlMs) ? `${method}:${url}` : null);
    const cacheEntry = effectiveCacheKey ? readCache(effectiveCacheKey) : null;
    const useCacheEntry = (entry, stale) => {
      if (!entry) return null;
      const ageMs = Date.now() - entry.timestamp;
      const meta = {
        cacheKey: effectiveCacheKey,
        fetchedAt: entry.fetchedAt,
        fromCache: true,
        stale,
        ageMs,
      };
      return attachMeta(entry.payload, meta);
    };
    if (!forceRefresh && cacheEntry && cacheTtlMs > 0) {
      const age = Date.now() - cacheEntry.timestamp;
      if (age <= cacheTtlMs) {
        if (typeof onCacheHit === 'function') {
          try {
            onCacheHit({ cacheKey: effectiveCacheKey, ageMs: age, stale: false });
          } catch (_) {}
        }
        return useCacheEntry(cacheEntry, false);
      }
    }
    let attempt = 0;
    let delayMs = Math.max(0, retryDelayMs);
    let lastError = null;
    while (attempt <= retries) {
      if (attempt > 0 && delayMs > 0) {
        await wait(delayMs);
      }
      attempt += 1;
      const { signal, ...rest } = options || {};
      const controller = timeoutMs ? new AbortController() : null;
      if (controller && signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
      }
      let timedOut = false;
      const timeoutId = timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            controller?.abort();
          }, timeoutMs)
        : null;
      try {
        const response = await fetchFn(url, { ...rest, signal: controller ? controller.signal : signal });
        if (!response || typeof response.status !== 'number') {
          throw new Error('Respuesta inválida del fetch.');
        }
        if (!response.ok) {
          let bodyText = '';
          try {
            bodyText = await response.text();
          } catch (_) {}
          const error = new Error(bodyText ? `HTTP ${response.status} ${bodyText}` : `HTTP ${response.status}`);
          error.status = response.status;
          error.response = response;
          throw error;
        }
        const payload = await response.json();
        if (effectiveCacheKey && cacheTtlMs > 0) {
          const entry = {
            timestamp: Date.now(),
            fetchedAt: new Date().toISOString(),
            payload,
          };
          writeCache(effectiveCacheKey, entry);
          return attachMeta(payload, {
            cacheKey: effectiveCacheKey,
            fetchedAt: entry.fetchedAt,
            fromCache: false,
            stale: false,
            ageMs: 0,
          });
        }
        return payload;
      } catch (err) {
        let fetchError = err instanceof Error ? err : new Error(String(err));
        if (timedOut) {
          const timeoutError = new Error(`Tiempo de espera agotado tras ${timeoutMs}ms para ${url}`);
          timeoutError.code = 'ETIMEDOUT';
          timeoutError.cause = fetchError;
          fetchError = timeoutError;
        }
        const response = fetchError.response || null;
        const decider = typeof retryDecider === 'function' ? retryDecider : defaultRetryDecider;
        const shouldRetry = attempt <= retries && decider({ error: fetchError, response, attempt, retries });
        if (shouldRetry) {
          lastError = fetchError;
          delayMs = delayMs > 0 ? Math.round(delayMs * backoffFactor) : Math.round(retryDelayMs * backoffFactor);
          continue;
        }
        if (cacheEntry && staleTtlMs > 0) {
          const age = Date.now() - cacheEntry.timestamp;
          if (age <= staleTtlMs) {
            logger?.warn?.(
              logPrefix,
              `Fallo solicitando ${url}: ${fetchError.message || fetchError}. Usando cache local (${Math.round(age / 1000)}s).`,
            );
            return useCacheEntry(cacheEntry, true);
          }
        }
        throw fetchError;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
    if (cacheEntry && staleTtlMs > 0) {
      const age = Date.now() - cacheEntry.timestamp;
      if (age <= staleTtlMs) {
        logger?.warn?.(
          logPrefix,
          `Fallo persistente solicitando ${url}. Usando cache local (${Math.round(age / 1000)}s).`,
        );
        return useCacheEntry(cacheEntry, true);
      }
    }
    if (lastError) throw lastError;
    throw new Error(`No se pudo obtener ${url}`);
  };
  return {
    requestJson,
    getCacheEntry: (key) => readCache(key),
    clearCacheEntry: (key) => removeCache(key),
  };
};
