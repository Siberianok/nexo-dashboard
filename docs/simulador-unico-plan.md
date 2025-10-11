# Plan para el simulador único de préstamos cripto

Este documento resume las dos funciones destacadas para evolucionar el simulador: un **planificador de cashflow** integral y un **benchmark híbrido CeFi/DeFi**. Ambas ideas están pensadas para convivir dentro del mismo tablero y compartir las fuentes de datos y los presets actuales (Nexo, Binance, etc.).

## 1. Planificador de cashflow

Objetivo: anticipar entradas y salidas de fondos, alertando sobre descalces entre el rendimiento estimado y las obligaciones del préstamo.

### Entradas necesarias
- Cronograma de pagos del préstamo: capital, interés, fecha de corte.
- Flujos de Earn / staking: monto, frecuencia, plataforma y token.
- Aportes manuales: recargas de colateral, compras o ventas programadas.

### Métricas y visualizaciones
- Curva de saldo neto (balance acumulado en el tiempo).
- Alertas automáticas cuando el LTV proyectado supera los límites configurados.
- Panel de stress-test con escenarios "base", "bajista" y "alcista" para precios del colateral.

### Integración con el simulador actual
- Reutilizar el `localStorage` para persistir cronogramas personalizados.
- Permitir exportar/ importar un JSON portátil para compartir configuraciones.
- Sincronizar el velocímetro LTV con el saldo proyectado del cashflow.

## 2. Benchmark CeFi vs. CeFi/DeFi

Objetivo: comparar automáticamente la rentabilidad de abrir un préstamo en una plataforma CeFi y poner el capital a rendir en otra (CeFi o DeFi), resaltando el spread neto después de comisiones.

### Componentes clave
- **Matriz de tasas**: catálogo editable de APR/APY por plataforma y producto (Earn, staking, pools DeFi).
- **Simulador de estrategias**: para cada combinación préstamo→rendimiento, calcular interés pagado, interés ganado y spread.
- **Gestión de riesgos**: bandera para custodios centralizados, protocolos DeFi y pools con smart contracts nuevos.

### Métricas y salidas
- Spread neto anualizado y efectivo para el plazo del préstamo.
- Tiempo de break-even (en días) considerando fees de entrada/salida.
- Tabla comparativa con ranking por rentabilidad ajustada al riesgo.

### Extensión DeFi
- Conectores a APIs públicas (por ejemplo, DefiLlama) para obtener yields actualizados.
- Parámetros de ajuste por riesgo (slippage, impermanent loss en pools AMM).
- Posibilidad de agregar manualmente estrategias DeFi que no tengan API.

## Próximos pasos sugeridos
1. Diseñar wireframes del cashflow planner y del comparador de estrategias.
2. Definir estructura de datos compartida para préstamos, estrategias y escenarios.
3. Implementar un módulo de cálculo independiente en JavaScript para facilitar tests.
4. Integrar gradualmente las visualizaciones dentro del `index.html` existente.

