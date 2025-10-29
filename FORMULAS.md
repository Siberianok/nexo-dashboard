# FORMULAS.md

## LTV actual
\[
\text{LTV} = \frac{\text{debt}}{\text{collateralAmount} \times \text{price}}
\]
- `debt`: préstamo vigente en USDT.
- `collateralAmount`: unidades del activo.
- `price`: cotización local (USDT por unidad).

## Precio de liquidación
\[
\text{price}_\text{liq} = \frac{\text{debt}}{\text{collateralAmount} \times \text{ltvThreshold}_{\text{liq}}}
\]
- `ltvThreshold_liq`: LTV de liquidación configurado para el activo.

## Tasa anual neta
\[
\text{netApr} = \text{borrowAprUSDT} - \max(\text{LTV}, \text{ltvFloor}) \times \alpha_{\text{asset}} \times \text{collateralApr}_{\text{asset}}
\]
- `borrowAprUSDT`: APR base del préstamo en USDT.
- `ltvFloor`: piso mínimo a considerar.
- `\alpha`: factor de calibración por activo.
- `collateralApr`: APR flexible estimado del Earn.

## Interés devengado (interés simple)
\[
\text{accrued} = \text{debt} \times \text{borrowAprUSDT} \times \frac{\Delta t_{\text{días}}}{365}
\]
- `Δt_días`: días transcurridos desde `startedAtMs` hasta el snapshot actual (`updatedAtMs`).

### Ejemplo ADA
- `debt` = 10 425.78556987 USDT
- `collateralAmount` = 32 713.88524449 ADA
- `price` = 0.6639500763 USDT/ADA
- `ltvThreshold_liq` = 0.91
- `collateralApr` = 0.03
- `α` = 0.0561375
- `Δt` ≈ 1.1256 días

Resultados:
- `LTV` ≈ 0.48 (48 %)
- `price_liq` ≈ 0.350215 USDT/ADA
- `netApr` ≈ 0.04747902 (4.747902 %)
- `accrued` ≈ 1.55251766 USDT
