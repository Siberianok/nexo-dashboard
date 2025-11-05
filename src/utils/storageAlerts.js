const DEFAULT_STORAGE_RECOVERY_HINT = 'Sugerencia: revisá los permisos de almacenamiento del navegador o usá los botones "Reset" en Plantillas & datos.';

export function buildStorageAlert({
  key,
  title = 'Preferencias no disponibles',
  message,
  error,
  hint = DEFAULT_STORAGE_RECOVERY_HINT,
  tone = 'warn',
}) {
  const detail = error ? ` Detalle: ${error?.message || error}.` : '';
  return {
    key,
    title,
    message: `${message}${detail}`,
    hint,
    tone,
  };
}

export { DEFAULT_STORAGE_RECOVERY_HINT };

if (typeof globalThis !== 'undefined') {
  const scope = globalThis;
  if (!scope.buildStorageAlert) {
    scope.buildStorageAlert = buildStorageAlert;
  }
  if (scope.window && !scope.window.buildStorageAlert) {
    scope.window.buildStorageAlert = buildStorageAlert;
  }
}
