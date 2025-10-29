# CONFIG.md

## Parámetros principales

| Clave | Descripción |
| --- | --- |
| `borrowAprUSDT` | APR anual del préstamo en USDT expresado como decimal (ej. `0.0482874` = 4.82874%). |
| `ltvFloor` | Piso mínimo del LTV usado para ponderar la tasa neta. |
| `ltvThreshold[ASSET].liq` | LTV de liquidación del activo (decimal). Determina el precio de liquidación. |
| `collateralApr[ASSET]` | APR estimado para el Earn flexible del colateral (decimal). |
| `alpha[ASSET]` | Factor de calibración (0–1) que pondera cuánto Earn se descuenta sobre el APR del préstamo. |

## Estado por par (`pairs[ASSET]`)

Cada activo colateralizado se describe con los siguientes campos:

| Campo | Descripción |
| --- | --- |
| `debt` | Préstamo vigente en USDT (principal). |
| `collateralAmount` | Cantidad de colateral (en unidades del activo). |
| `price` | Precio spot local (USDT por unidad de colateral). |
| `startedAtMs` | Timestamp (ms) del último evento que reinició el interés simple. |
| `updatedAtMs` | Timestamp (ms) del snapshot vigente utilizado para acumular interés. |

El objeto de configuración vive en `index.html` bajo `BASE_LOAN_SIM_CONFIG`. Cualquier override opcional puede cargarse en `window.__LOAN_SIM_CONFIG__` antes de montar la app; los campos ausentes se heredan del baseline.
