import { useCallback, useEffect, useRef, useState } from 'react';
import { buildStorageAlert } from '../../../utils/storageAlerts';

export type StorageAlert = ReturnType<typeof buildStorageAlert>;

export const useStorageAlerts = () => {
  const storageAlertsRef = useRef<StorageAlert[]>([]);
  const [storageAlerts, setStorageAlerts] = useState<StorageAlert[]>([]);

  const registerInitialStorageAlert = useCallback((alert?: StorageAlert | null) => {
    if (!alert || !alert.key) return;
    if (!storageAlertsRef.current.some((item) => item.key === alert.key)) {
      storageAlertsRef.current.push(alert);
    }
  }, []);

  const pushStorageAlert = useCallback((alert?: StorageAlert | null) => {
    if (!alert || !alert.key) return;
    setStorageAlerts((prev) => (prev.some((item) => item.key === alert.key) ? prev : [...prev, alert]));
  }, []);

  const dismissStorageAlert = useCallback((key: string) => {
    setStorageAlerts((prev) => prev.filter((item) => item.key !== key));
  }, []);

  useEffect(() => {
    if (storageAlertsRef.current.length === 0) return;
    setStorageAlerts((prev) => {
      const existing = new Set(prev.map((item) => item.key));
      const additions = storageAlertsRef.current.filter((item) => !existing.has(item.key));
      storageAlertsRef.current = [];
      if (!additions.length) return prev;
      return [...prev, ...additions];
    });
  }, []);

  return {
    storageAlerts,
    registerInitialStorageAlert,
    pushStorageAlert,
    dismissStorageAlert,
  } as const;
};
