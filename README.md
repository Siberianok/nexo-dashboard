# Simulador de Préstamos Mejor — HTML (portable)

Simulador multiplataforma (Nexo, Binance, etc.) con **precios en vivo**, **LTV**, **APR por tier**, **cap low-cost (≤20%)**, cálculo de **intereses** y estimación de **Earn**.
Es 100% estático: un solo `index.html` con TailwindCDN, React UMD y CoinGecko (sin API key).

## 🧩 Características
- **Selector de plataforma** con presets para Nexo y Binance.
- **Botón "Cargar vista previa"** para ver un tablero de muestra en segundos.
- **Datos en vivo** (CoinGecko) con intervalo configurable.
- **KPIs** tipo “botón”, cálculo de **Loyalty Tier** (Base/Silver/Gold/Platinum).
- **Tope por LTVs** (colateral ponderado), **recomendado ≤20%**, y **diagnóstico**.
- **Velocímetro LTV** (SVG) y **gráfico costo vs. earn** en el tiempo.
- **Persistencia local** en `localStorage` (activos y parámetros).

## 🚀 Uso rápido
1. Abrí `index.html` en el navegador.  
   **Sugerido**: servirlo con un mini-servidor local para evitar bloqueos CORS.
2. Editá tus activos (cantidad, toggle “Auto” para precios en vivo, marcar como colateral).
3. Ajustá parámetros (USD→ARS, frecuencia de refresco, Earn On/Off).
4. Simulá un préstamo (monto + fecha de repago).

