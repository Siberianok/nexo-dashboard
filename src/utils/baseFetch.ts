export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const isFunction = (value: unknown): value is (...args: never[]) => unknown => typeof value === 'function';

const bindFetch = (fetchFn: unknown): FetchLike | null => {
  if (!isFunction(fetchFn)) return null;
  try {
    return fetchFn.bind(typeof window !== 'undefined' ? window : undefined) as FetchLike;
  } catch {
    return fetchFn as FetchLike;
  }
};

export const resolveBaseFetch = (): FetchLike | null => {
  if (typeof window === 'undefined') {
    if (typeof fetch === 'function') {
      return bindFetch(fetch);
    }
    return null;
  }

  const shimFetch = (window as typeof window & { __nexoShimClient?: { fetch?: FetchLike } }).__nexoShimClient?.fetch;
  if (isFunction(shimFetch)) {
    return shimFetch.bind(window) as FetchLike;
  }

  const apiClientFetch = (window as typeof window & { __nexoApiClient?: { baseFetch?: FetchLike } }).__nexoApiClient?.baseFetch;
  if (isFunction(apiClientFetch)) {
    return apiClientFetch.bind(window) as FetchLike;
  }

  if (typeof window.fetch === 'function') {
    return window.fetch.bind(window) as FetchLike;
  }

  if (typeof fetch === 'function') {
    return bindFetch(fetch);
  }

  return null;
};

export const ensureBaseFetch = (): FetchLike => {
  const fn = resolveBaseFetch();
  if (!fn) {
    throw new Error('fetch no está disponible en este entorno.');
  }
  return fn;
};
