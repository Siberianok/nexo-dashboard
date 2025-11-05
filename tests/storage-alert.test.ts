import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it('storage reads fallback to alerts when localStorage throws', async () => {
  const globalScope = globalThis as Record<string, any>;
  const originalWindow = globalScope.window;
  try {
    const scope: Record<string, unknown> = {};
    globalScope.window = scope;
    const moduleUrl = pathToFileURL(path.resolve('src/utils/storageAlerts.js')).href;
    await import(`${moduleUrl}?t=${Date.now()}`);

    let registeredAlert: any = null;
    const registerInitialStorageAlert = (alert: any) => {
      registeredAlert = alert;
    };

    const initialPlatformId = 'binance';
    const PLATFORM_IDS = [initialPlatformId, 'nexo'];
    const localStorage = {
      getItem(key: string) {
        if (String(key).startsWith('spm_')) {
          throw new Error('Acceso denegado');
        }
        return null;
      },
    };

    const platformId = (() => {
      try {
        const stored = localStorage.getItem('spm_platform');
        return PLATFORM_IDS.includes(stored) ? stored : initialPlatformId;
      } catch (err) {
        registerInitialStorageAlert(globalScope.window.buildStorageAlert({
          key: 'read-spm_platform',
          message: 'No se pudo leer la última plataforma seleccionada. Se usará la plataforma por defecto.',
          error: err,
        }));
        return initialPlatformId;
      }
    })();

    expect(platformId).toBe(initialPlatformId);
    expect(registeredAlert).toBeTruthy();
    expect(registeredAlert.key).toBe('read-spm_platform');
    expect(registeredAlert.message).toMatch(/Detalle: Acceso denegado/);
  } finally {
    if (originalWindow === undefined) {
      delete globalScope.window;
    } else {
      globalScope.window = originalWindow;
    }
  }
});
