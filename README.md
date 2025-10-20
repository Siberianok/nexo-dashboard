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

El repositorio incluye un micro-servicio Node.js que consulta la API oficial de Binance Loans (endpoint SAPI) y entrega los parámetros actualizados al simulador. Desde la interfaz podés ingresar tu API Key y tu API Secret para habilitar la sincronización y visualizar los datos en tiempo real. Si la API no responde o las credenciales faltan, el simulador recurre automáticamente a los valores predeterminados embebidos en `index.html`.
