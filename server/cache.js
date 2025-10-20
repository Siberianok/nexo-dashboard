export class MemoryCache {
  constructor(defaultTtlMs = 0) {
    this.defaultTtlMs = Math.max(0, Number(defaultTtlMs) || 0);
    this.store = new Map();
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    const ttl = Math.max(0, Number(ttlMs) || 0);
    const entry = {
      value,
      expiresAt: ttl > 0 ? Date.now() + ttl : null,
    };
    this.store.set(key, entry);
    return value;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}
