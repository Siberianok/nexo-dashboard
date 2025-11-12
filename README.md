# Simulador de Préstamos — Vite + React

Simulador multiplataforma (Nexo, Binance, etc.) con **precios en vivo**, **LTV**, **APR por tier**, cálculo de **intereses**, estimación de **Earn** y planificador de cashflow. Vive en un proyecto moderno (Vite + React + TypeScript) pero sigue publicándose como **sitio estático** compatible con GitHub Pages.

## 🚀 Uso rápido
1. Instalá dependencias (`npm install`).
2. Levantá el dev server con `npm run dev` (Vite expone el dashboard en `http://localhost:5173`).
3. Ajustá parámetros (frecuencia de refresco, Earn on/off, preset de plataforma) y simulá tu préstamo.
4. Generá el build para GitHub Pages con `npm run build` → los assets terminan en `dist/` con rutas relativas.

> ¿Querés un build ultra portable? El resultado sigue siendo HTML/CSS/JS plano dentro de `dist/`. Podés servirlo con `python3 -m http.server`, `npx serve dist`, Netlify o GitHub Pages sin tocar configuraciones extra.

## 🧪 Scripts disponibles
- `npm run dev`: entorno de desarrollo con recarga caliente.
- `npm run build`: build optimizado listo para deploy estático.
- `npm run preview`: sirve el contenido generado en `dist/` para validarlo.
- `npm run lint`: corre la verificación de tipos (`tsc --noEmit`).
- `npm run test`: corre Vitest + Testing Library sobre los componentes clave.

> El micro-servicio Node que vivía en Render fue retirado. Ahora la app es 100 % estática y el preset remoto quedó deshabilitado: el modelo dinámico corre en el navegador con datos públicos.

## 🔍 Endpoints del preset estático Binance
El shim del navegador intercepta las solicitudes `fetch` a `/api/binance/*` y las redirige a archivos JSON locales dentro de `public/api`. Asegurate de que esos respaldos queden versionados para que el build no falle aun sin conectividad.

- `/api/binance/loans` → `public/api/binance/loans.json` (snapshot completo del preset).
- `/api/binance/loanable` → `public/api/binance/loanable.json` (tasas de préstamo por moneda).
- `/api/binance/collateral` → `public/api/binance/collateral.json` (parámetros de colateral disponibles).
- `/api/binance/snapshot` → alias de `/api/binance/loans`.
- `/api/admin/state` → `public/api/admin/state.json` (estado de cache del simulador).

## 🔄 Binance en tiempo real (opcional)
- **API keys personales**: ingresá tu `API Key` y `Secret` (permiso READ) en el panel "Binance Live" para sincronizar préstamos, APR y parámetros de colateral directamente con los endpoints SAPI oficiales.
- **Modelo dinámico**: sin backend. El panel “Modelo dinámico activo” resume la cache local, la edad del snapshot y el origen `dynamic_model` generado con fórmulas + APIs públicas de spot/funding.

## 📐 Fórmula de APR Neto
La métrica de costo real se documenta y calcula así (decimales):

```
netApr = borrowApr − (collateralApr / max(initialLtv, ltv.initClamp))
```

- `borrowApr`: APR anualizado del préstamo Binance Loan.
- `collateralApr`: APR flexible de Simple Earn para el colateral.
- `initialLtv`: LTV inicial reportado por Binance (o el actual si viene de la API de órdenes).
- `ltv.initClamp`: perilla para clavar un LTV mínimo cuando la API devuelva valores nulos o muy bajos.

El tablero usa este APR neto para ponderar préstamos abiertos, calcular spreads y colorear los paneles de riesgo.

## ⚙️ Controles avanzados (`params.controls`)
Podés ajustar cuatro perillas para stress tests y calibración:

| Clave | Descripción |
| --- | --- |
| `aprFundingAlpha` (0–1) | Factor de ponderación del Earn cuando se resta al costo del préstamo. Ej.: `0.6` solo descuenta el 60 % del Earn proyectado. |
| `aprClamp` | Piso (en decimales) para el APR neto anualizado. Útil para evitar spreads negativos irreales. |
| `sigmaK` | Escala los shocks de precio de los escenarios (base/bear/bull) en el plan de cashflow. |
| `ltv.initClamp` | LTV mínimo (decimal) al calcular spreads o APR neto cuando Binance no reporta el valor inicial. |

Los presets embebidos heredan estos valores y cualquier JSON remoto puede sobreescribirlos dentro de `defaultParams.controls`.

## 🧾 `collateralYield.<ASSET>.apr`
Cada preset puede definir yields de colateral manuales mediante:

```json
{
  "collateralYield": {
    "ADA": { "apr": 0.021, "source": "manual 2024-04" },
    "BTC": { "apr": 0.03 }
  }
}
```

El simulador los usa como fallback para el Earn flexible (columna “APR Earn”) y para calcular el APR neto si no hay datos en vivo. Cuando conectás tu cuenta Binance, las lecturas SAPI sobrescriben estos valores.

## 🏁 Flags de simulación
- `?sim=1`: carga automáticamente la vista previa del tablero para inspeccionarlo sin completar formularios.
- `?forceOn=1` o `window.__SIMULATOR_FORCE_ON__ = true`: fuerza la elegibilidad de Earn aunque no alcances el mínimo de balance y mantiene el Earn activo para pruebas.

Ambos flags se pueden combinar. El estado se muestra en los indicadores (“forzado (sim)”).

## 📂 Estructura del repo
- `index.html`: HTML base + configuración embebida (`#sim-model-config`).
- `public/`: assets estáticos que Vite copia tal cual al build (incluye los respaldos del shim Binance en `public/api/**`).
- `src/`: componentes React, lógica del simulador, estilos y shims del runtime.
- `tests/`: pruebas unitarias (Vitest) para presets, storage y configuración embebida.

¡Listo! Con `npm run build` y el branch configurado para GitHub Pages, el dashboard vuelve a publicarse con todos los estilos y mejoras visuales.
