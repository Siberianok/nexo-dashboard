import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('storage reads fallback to alerts when localStorage throws', async () => {
  const originalWindow = globalThis.window;
  try {
    const scope = {};
    globalThis.window = scope;
    const moduleUrl = pathToFileURL(path.resolve('src/utils/storageAlerts.js')).href;
    await import(`${moduleUrl}?t=${Date.now()}`);

    let registeredAlert = null;
    const registerInitialStorageAlert = (alert) => {
      registeredAlert = alert;
    };

    const initialPlatformId = 'binance';
    const PLATFORM_IDS = [initialPlatformId, 'nexo'];
    const localStorage = {
      getItem(key) {
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
        registerInitialStorageAlert(globalThis.window.buildStorageAlert({
          key: 'read-spm_platform',
          message: 'No se pudo leer la última plataforma seleccionada. Se usará la plataforma por defecto.',
          error: err,
        }));
        return initialPlatformId;
      }
    })();

    assert.strictEqual(platformId, initialPlatformId);
    assert.ok(registeredAlert, 'expected an alert to be registered');
    assert.strictEqual(registeredAlert.key, 'read-spm_platform');
    assert.match(registeredAlert.message, /Detalle: Acceso denegado/);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});
