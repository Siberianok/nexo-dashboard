# Checklist "Binance Loans – Tasas & Liquidación en tiempo real"

## 0) Permisos y reloj

- [ ] Crear API Key con permisos **READ** para Loans y Simple Earn (`SAPI`, endpoints `USER_DATA`). Restringir por IP.
- [ ] Sincronizar el scheduler con el *server time* de Binance y refrescar cada 60 s (las tasas de Flexible Loan se actualizan por minuto y el interés acumula por minuto).

## 1) Fuentes de datos (endpoints oficiales)

- [ ] **Tasa del préstamo (APR anualizado del asset prestado)**  \
  `GET /sapi/v2/loan/interestRateHistory?coin=<LOAN_COIN>&limit=1` → `rows[0].annualizedInterestRate` (decimal). Guardar como `borrowApr`.
- [ ] **APR del colateral (Simple Earn Flexible)**  \
  `GET /sapi/v1/simple-earn/flexible/list?asset=<COLLATERAL_COIN>` → `rows[0].latestAnnualPercentageRate` (decimal). Guardar como `collateralApr`.  \
  Opcional (más preciso si hay tramos): `GET /sapi/v1/simple-earn/flexible/position` para leer el APR aplicado a tu posición.
- [ ] **Parámetros de riesgo del colateral**  \
  `GET /sapi/v2/loan/flexible/collateral/data?collateralCoin=<COLLATERAL_COIN>` → `initialLTV`, `marginCall`, `liquidationLTV`.
- [ ] **Tus posiciones vivas (montos reales y LTV actual)**  \
  `GET /sapi/v2/loan/flexible/ongoing/orders` → `totalDebt`, `collateralAmount`, `currentLTV` por par préstamo/garantía. Úsalo para “clavar” la UI a la realidad de tu cuenta.
- [ ] **Precios índice (los que usa Loans para el LTV)**  \
  `GET /fapi/v1/premiumIndex?symbol=<ASSET>USDT` → `indexPrice`.

## 2) Cálculos que deben salir 1:1 con Binance

### 2.1 APR neto (tu métrica de costo real)

- [ ] Fórmula (en decimales): `netApr = borrowApr − (collateralApr / initialLTV)`.
- [ ] Mostrar `borrowApr` y `netApr` con 2–3 decimales (%) y timestamp “actualizado hace X s”.

### 2.2 LTV en tiempo real

- [ ] Fórmula oficial (con precios índice USDT):  \
  `LTV(t) = (Pᵇ_index_USDT · BorrowAmount) / (Pᶜ_index_USDT · CollateralAmount)`.
- [ ] Usar `totalDebt` (incluye principal + interés acumulado) como `BorrowAmount` para cuadrar con la UI.

### 2.3 Precio de liquidación estimado (y de margin call)

- [ ] Con `LiquidationLTV = L_liq` y `MarginCallLTV = L_mc` del endpoint de colaterales:  \
  `Precio_liq (colateral/USDT) = (Pᵇ_index_USDT · BorrowAmount) / (L_liq · CollateralAmount)`  \
  `Precio_marginCall = (Pᵇ_index_USDT · BorrowAmount) / (L_mc · CollateralAmount)`.
- [ ] Usar `indexPrice` de ambos assets y `totalDebt`/`collateralAmount` de tus órdenes vivas.
- [ ] Recordatorio: si el préstamo es USDT, entonces `Pᵇ_index_USDT ≈ 1`, pero sigue tomándolo del índice para ser exacto.

## 3) Frecuencia, coherencia y “anti-desfase”

- [ ] Polling: refrescar cada 60 s como mínimo (tasas Loans y *accrual* por minuto).
- [ ] Agrupar lecturas: en cada tick, leer todo (APR préstamo, APR colateral, LTVs, posiciones, index prices) y calcular con el mismo timestamp (o lo más cercano posible).
- [ ] Orden recomendado de llamada:
  1. `premiumIndex` (borrow + collateral) → precios.
  2. `ongoing/orders` → `totalDebt`, `collateralAmount`, `currentLTV`.
  3. `interestRateHistory` → `borrowApr`.
  4. `simple-earn/flexible/list` → `collateralApr`.
  5. `collateral/data` → `initialLTV`, `marginCall`, `liquidationLTV`.
- [ ] Mostrar “staleness badge” si algún dato > 90 s.
- [ ] Redondeo: usar los mismos redondeos que tu UI (p. ej., 2 decimales en %, 6–8 en precios de liquidación de alts).
- [ ] Errores/timeout: no congelar cifras; mostrar último valor + aviso “reintentando…”.

## 4) Qué debe ver el usuario (componentes del dashboard)

- [ ] APR préstamo (anual) y APR neto lado a lado, con flecha ↑/↓ si cambia vs. tick anterior.
- [ ] LTV actual + barras de Margin Call y Liquidación (85 % / 90–91 % típico, pero tomar del endpoint por activo).
- [ ] Precio de liquidación estimado (par `COLLATERAL/USDT`) y precio de margen; recalcular ante cambios de:
  - `indexPrice`.
  - `totalDebt` (interés/minuto o repagos).
  - `collateralAmount` (agregar/quitar garantía).
- [ ] Marca de tiempo “actualizado a las hh:mm:ss (UTC)”.

## 5) Validaciones para que coincida con Binance (DoD)

- [ ] En una posición real, el `LTV(t)` calculado debe coincidir (±0.01–0.02 p.p.) con `currentLTV` del endpoint de órdenes vivas. Si no, revisar precios índice usados.
- [ ] La tasa anual mostrada debe igualar la última `annualizedInterestRate`.
- [ ] El APR neto debe bajar cuando sube el APR del colateral o cuando baja `initialLTV` (por activo).
- [ ] El precio de liquidación calculado debe cruzar con el valor mostrado en la UI al variar `BorrowAmount` o `CollateralAmount` (simular un “Ajustar LTV”).

## 6) Notas finas (para evitar sorpresas)

- [ ] Interés acumulado: usar `totalDebt` (principal + interés/minuto) en los cálculos de LTV y liquidación; no el principal original.
- [ ] Índice vs último precio: Loans usa USDT *index price* (no el último trade). Usar `premiumIndex.indexPrice` para cada asset.
- [ ] Tiers de Simple Earn: si tu monto en garantía supera tramos, el APR efectivo puede diferir del “latest” del catálogo. Para máxima precisión, leer tu posición flexible.
- [ ] Límites por activo: `initialLTV`, `marginCall`, `liquidationLTV` cambian por colateral (p. ej., algunos usan 85 % / 90 %, otros hasta 91 %). No hardcodear.
- [ ] Unidades: todos los APR vienen en decimales (`0.050 = 5.0 %`). Convertir a % solo al render.

## 7) Fórmulas (para documentación interna del tablero)

- [ ] `APR neto: netApr = borrowApr − (collateralApr / initialLTV)` (decimales).
- [ ] `LTV(t): LTV = (Pᵇ_index_USDT · BorrowAmount) / (Pᶜ_index_USDT · CollateralAmount)`.
- [ ] `Precio de liquidación (colateral/USDT): P_liq = (Pᵇ_index_USDT · BorrowAmount) / (LiquidationLTV · CollateralAmount)`.
- [ ] `Precio de margin call: P_mc = (Pᵇ_index_USDT · BorrowAmount) / (MarginCallLTV · CollateralAmount)`.

## 8) Checklist de pruebas (sobre tus dos posiciones del pantallazo)

- [ ] Leer `ongoing/orders` para cada par (ej.: USDT prestado / ADA colateral y USDT prestado / ALGO colateral) y anotar `totalDebt`, `collateralAmount`, `currentLTV`.
- [ ] Leer `collateral/data` para ADA y ALGO → `initialLTV`, `marginCall`, `liquidationLTV`.
- [ ] Obtener `indexPrice` de USDT (prestado) y del colateral (ADA o ALGO).
- [ ] Verificar que `LTV(t)` coincide con `currentLTV`. Si difiere, confirmar que usas `indexPrice`, no `lastPrice`.
- [ ] Calcular `P_liq` y `P_mc` y comparar con la UI (tu captura muestra 85 % y 91 % como umbrales).
- [ ] Subir/bajar `collateralAmount` (simulación) y ver que `P_liq` se mueve en la misma dirección que la UI.

## Citas clave (por qué todo esto cuadra con Binance)

- Loans usa “Price Index” y define la fórmula oficial del LTV. *(Binance)*
- Las tasas de Flexible Loan se actualizan por minuto; el interés se acumula por minuto. *(Binance)*
- APR del préstamo (histórico en tiempo real). *(developers.binance.com)*
- APR de Simple Earn Flexible (`latestAnnualPercentageRate`). *(developers.binance.com)*
- LTVs por colateral (`initial`, `margin call`, `liquidation`). *(developers.binance.com)*
- Tus órdenes vivas devuelven deuda total y LTV actual para “pegarle” a la UI. *(developers.binance.com)*
- Index price en tiempo real (`premiumIndex` → `indexPrice`). *(developers.binance.com)*
