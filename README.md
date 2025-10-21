# Simulador de Préstamos — HTML (portable)

Simulador multiplataforma (Nexo, Binance, etc.) con **precios en vivo**, **LTV**, **APR por tier**, **cap low-cost (≤20%)**, cálculo de **intereses** y estimación de **Earn**.
Incluye un `index.html` auto-contenido con TailwindCDN, React UMD y CoinGecko (sin API key) más un micro-servicio opcional para
sincronizar parámetros de Binance Loans en tiempo real.

## 🧩 Características
- **Selector de plataforma** con presets para Nexo y Binance.
- **Botón "Cargar vista previa"** para ver un tablero de muestra en segundos.
- **Datos en vivo** (CoinGecko) con intervalo configurable.
- **KPIs** tipo “botón”, cálculo de **Loyalty Tier** (Base/Silver/Gold/Platinum).
- **Tope por LTVs** (colateral ponderado), **recomendado ≤20%**, y **diagnóstico**.
- **Velocímetro LTV** (SVG) y **gráfico costo vs. earn** en el tiempo.
- **Persistencia local** en `localStorage` (activos y parámetros).

### Próximas funcionalidades
- **Planificador de cashflow** con escenarios de stress y alertas de LTV proyectado.
- **Benchmark CeFi/DeFi** para comparar préstamos y estrategias de rendimiento cross-plataforma.
- Más detalles en [`docs/simulador-unico-plan.md`](docs/simulador-unico-plan.md).

## 🚀 Uso rápido
1. Abrí `index.html` en el navegador.
   **Sugerido**: servirlo con un mini-servidor local para evitar bloqueos CORS.
2. Editá tus activos (cantidad, toggle “Auto” para precios en vivo, marcar como colateral).
3. Ajustá parámetros (USD→ARS, frecuencia de refresco, Earn On/Off).
4. Simulá un préstamo (monto + fecha de repago).

## 🔄 Sincronización automática con Binance Loans

El repositorio ahora incluye un micro-servicio Node.js que consulta la API oficial de Binance Loans (endpoint SAPI) y entrega los
parámetros actualizados al simulador.

1. Copiá `.env.example` a `.env` y completá `BINANCE_API_KEY` y `BINANCE_API_SECRET` con una API key de Binance con permisos para
   Loans (lectura).
2. Instalá dependencias: `npm install`.
3. Levantá el servidor: `npm run dev`.
4. Abrí `http://localhost:3000` (o el puerto configurado en `PORT`). El front-end buscará `./api/binance/loans` (o el endpoint que
   definas con `?binanceApiEndpoint=`) y actualizará los LTV, tasas y precios de liquidación según la respuesta.

   > ¿Servís el HTML desde otra URL/base path o desde `file://`?
   > - Añadí `?binanceApiEndpoint=https://tu-servidor/api/binance/loans` a la URL o definí la variable global
   >   `window.__BINANCE_BASELINE_ENDPOINT__` antes del script para apuntar al backend correcto.
   > - El valor se guarda en `localStorage` (`spm_binanceBaselineEndpoint`) para evitar repetir la query.
   > - Si abrís el HTML directamente desde `file://`, el simulador probará `http://localhost:3000/api/binance/loans` por defecto.

> **Nota:** las claves se firman en el backend; el front-end sólo recibe datos agregados. El servidor mantiene la respuesta en
> caché (TTL configurable vía `BINANCE_CACHE_TTL_MS`).

Si la API no responde o las credenciales faltan, el simulador recurre a los valores predeterminados embebidos en `index.html`.

