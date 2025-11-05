// @ts-nocheck
export const initBinanceShim = () => {
  if (typeof window === 'undefined') {
    return;
  }
  if (window.__nexoShimClient) {
    return;
  }
  const STATIC_PREFIX = './api/binance/';
  const REMOTE_PREFIX = '/api/binance/';
  const API_PREFIX = (() => {
    try {
      const resolved = new URL(STATIC_PREFIX, window.location.href).pathname;
      return (resolved.endsWith('/') ? resolved : `${resolved}/`).replace(/\\/g, '/');
    } catch (_) {
      return REMOTE_PREFIX;
    }
  })();
  const MODE_KEY = 'spm_binanceShimMode';
  const ENDPOINT_KEY = 'spm_binanceBaselineEndpoint';

  window.__REMOTE_PRESET_DISABLED__ = true;

  const safeGetItem = (key) => {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  };
  const safeSetItem = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  };
  const safeRemoveItem = (key) => {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  };

  const resolveShimMode = () => {
    safeSetItem(MODE_KEY, 'static');
    return 'static';
  };

  resolveShimMode();

  const stripRemoteEndpointParam = () => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('binanceApiEndpoint')) {
        url.searchParams.delete('binanceApiEndpoint');
        const clean = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState(null, document.title, clean);
      }
    } catch (_) {}
  };
  stripRemoteEndpointParam();

  const resolveBaselineEndpoint = () => {
    safeRemoveItem(ENDPOINT_KEY);
    return new URL(`${STATIC_PREFIX}loans`, window.location.href).toString().replace(/\/$/, '');
  };

  const BASELINE_ENDPOINT = resolveBaselineEndpoint();
  window.__BINANCE_BASELINE_ENDPOINT__ = BASELINE_ENDPOINT;

  console.info('[shim] Binance baseline shim activo → modo estático forzado. Endpoint base:', BASELINE_ENDPOINT);

  const _fetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  if (!_fetch) {
    console.warn('[shim] fetch no está disponible, no se pudo inicializar el cliente shim.');
    return;
  }

  const toRequestUrl = (input) => {
    if (typeof input === 'string') {
      try {
        return new URL(input, window.location.href);
      } catch (_) {
        return null;
      }
    }
    if (input && typeof input === 'object' && typeof input.url === 'string') {
      try {
        return new URL(input.url, window.location.href);
      } catch (_) {
        return null;
      }
    }
    return null;
  };

  const mapToStatic = (pathname, search) => {
    const suffix = pathname.slice(API_PREFIX.length).replace(/^\/+/, '');
    const base = new URL(STATIC_PREFIX, window.location.href);
    const target = new URL(suffix || '.', base);
    if (!/\.json$/i.test(target.pathname)) {
      target.pathname = target.pathname.replace(/\/$/, '') + '.json';
    }
    if (search) target.search = search;
    return target.toString();
  };

  const cloneInit = (input, init) => {
    if (!input || typeof input !== 'object') return init;
    return {
      method: input.method,
      headers: input.headers,
      body: input.body,
      mode: input.mode,
      credentials: input.credentials,
      cache: input.cache,
      redirect: input.redirect,
      referrer: input.referrer,
      referrerPolicy: input.referrerPolicy,
      integrity: input.integrity,
      keepalive: input.keepalive,
      signal: input.signal,
      ...init,
    };
  };

  const shimFetch = (input, init) => {
    try {
      const requestUrl = toRequestUrl(input);
      if (requestUrl && requestUrl.pathname.startsWith(API_PREFIX)) {
        const staticUrl = mapToStatic(requestUrl.pathname, requestUrl.search);
        return typeof input === 'string'
          ? _fetch(staticUrl, init)
          : _fetch(staticUrl, cloneInit(input, init));
      }
    } catch (_) {}
    return _fetch(input, init);
  };

  window.__nexoShimClient = Object.freeze({
    fetch: shimFetch,
    mapToStatic,
    API_PREFIX,
    getMode: () => safeGetItem(MODE_KEY) || 'static',
    getBaselineEndpoint: () => window.__BINANCE_BASELINE_ENDPOINT__ || BASELINE_ENDPOINT,
  });
};
