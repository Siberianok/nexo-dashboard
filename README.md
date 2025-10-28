# Simulador de Préstamos — HTML (portable)

Simulador multiplataforma (Nexo, Binance, etc.) con **precios en vivo**, **LTV**, **APR por tier**, cálculo de **intereses**, estimación de **Earn** y planificador de cashflow. Todo el tablero vive en un único `index.html` (React + Tailwind vía CDN), sin build ni backend obligatorio.

## 🚀 Uso rápido
1. Abrí `index.html` directamente o servilo desde un servidor estático (recomendado para evitar CORS). Ejemplos:
   - Python: `python3 -m http.server 8000`
   - Node: `npx serve .`
2. Editá tus activos (cantidad, toggle “Auto” para precios en vivo, marcar como colateral).
3. Ajustá parámetros (frecuencia de refresco, Earn on/off, preset de plataforma).
4. Simulá un préstamo (monto + fecha de repago) y seguí la proyección de cashflow.

> El micro-servicio Node que vivía en Render fue retirado. Ahora la app es 100 % estática y el preset remoto quedó deshabilitado: el modelo dinámico corre en el navegador con datos públicos.

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
- `index.html`: todo el simulador (React + lógica + estilos).
- `docs/`: notas internas (checklists Binance, roadmap, etc.).
- `README.md`: este documento.

¡Listo! Con sólo `index.html` podés seguir iterando los presets, exportar/importar configuraciones (`Exportar JSON`) y documentar tus propios snapshots sin depender de servicios externos.
