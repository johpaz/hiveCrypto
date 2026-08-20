# Trading en hiveCrypto

hiveCrypto añade al runtime de agentes un vertical completo de mercados cripto: datos, análisis técnico, paper trading, testnet y backtesting. Esta guía cubre cómo funciona, cómo configurarlo y qué garantías da.

## Ninguna operación mueve dinero real

Es la propiedad más importante del producto, así que conviene ser preciso sobre cómo se sostiene.

`TRADING_MODE` admite exactamente tres valores:

| Modo | Lectura de mercado | Órdenes simuladas | Órdenes en el exchange |
|---|---|---|---|
| `readonly` | sí | no | no |
| `paper` (por defecto) | sí | sí | no |
| `testnet` | sí | sí | sí, contra el **sandbox** del exchange |

**No existe `mainnet`.** No es una bandera apagada: el código que ejecutaría órdenes contra una cuenta de producción no está escrito. Tres capas independientes lo sostienen:

1. Un valor desconocido de `TRADING_MODE` (incluidos `mainnet` o `live`) **degrada a `readonly`**, no falla abierto. Un typo en la configuración nunca habilita más de lo pedido.
2. La factory de exchanges separa las instancias: la que tiene credenciales llama a `setSandboxMode(true)` en el constructor y **verifica el resultado**, lanzando si el exchange no quedó en sandbox. La que apunta a producción nunca recibe credenciales.
3. Cada tool que envía una orden vuelve a comprobar el sandbox justo antes de mandarla, por si algo cambió entre la construcción y el envío.

## Configuración

Variables de entorno, en `~/.hivecrypto/.env`:

```bash
TRADING_MODE=paper            # readonly | paper | testnet
DEFAULT_EXCHANGE=binance      # cualquier id de CCXT
MAX_ORDER_NOTIONAL=100        # tope por orden, en la moneda de cotización
SYMBOL_WHITELIST=BTC/USDT,ETH/USDT   # vacío = todos los símbolos
EXCHANGE_WHITELIST=binance,kraken    # vacío = todos los exchanges
PAPER_FEE_RATE=0.001          # comisión simulada (0.001 = 0,1%)

# Sólo para TRADING_MODE=testnet — llaves del TESTNET, nunca de producción
BINANCE_API_KEY=...
BINANCE_SECRET=...
```

Los guardrails aplican a las órdenes, no a la lectura: consultar un precio nunca se bloquea por el tope de notional.

## Las 19 herramientas

**Mercado** (público, sin credenciales): `market_ticker`, `market_ohlcv`, `market_orderbook`, `market_trades`, `market_symbols`, `market_funding`.

**Análisis**: `ta_indicators`, `ta_levels`, `scan_markets`, `arbitrage_scan`.

**Paper trading**: `paper_account`, `paper_order`, `paper_positions`, `paper_close`, `paper_history`.

**Testnet**: `exchange_balance`, `exchange_order`, `exchange_orders`.

**Backtesting**: `backtest_run`.

### Por qué los indicadores coinciden con TradingView

RSI y ATR usan **suavizado de Wilder**, no una media simple. Muchas librerías de análisis técnico en JavaScript usan SMA y producen valores distintos, lo que hace que el número del agente no cuadre con el gráfico que el usuario tiene abierto. Los valores están verificados contra la serie de referencia publicada de Wilder (RSI(14) = 70,53 / 66,32 / 66,55 en los índices 14, 15 y 16).

## Cómo se llena una orden simulada

Una orden de mercado no se ejecuta a "el precio": recorre el libro consumiendo niveles.

Con este libro de ofertas de venta:

```
100,00 × 1 BTC
101,00 × 2 BTC
102,00 × 5 BTC
```

Comprar 3 BTC consume el primer nivel entero y dos del segundo: precio promedio `(100×1 + 101×2) / 3 = 100,67`. Eso es **slippage**, y es real aunque la operación sea simulada. Si el libro no da para toda la cantidad, la orden se llena **parcial** y el resultado lo dice; nunca se inventa liquidez.

El motor no abre cortos: vender más de lo que hay en la posición es un error, no una posición negativa.

## Los cuatro agentes especialistas

| Agente | Hace | No hace |
|---|---|---|
| **Analista de mercado** | Lee el mercado con datos e indicadores, entrega niveles concretos | No opera; su trabajo termina en el análisis |
| **Gestor de riesgo** | Dimensiona posiciones por riesgo y define la invalidación | No ejecuta; entrega el dimensionamiento |
| **Operador simulado** | Ejecuta y cierra operaciones simuladas, reporta el fill | No decide qué operar ni cuánto |
| **Investigador de estrategias** | Valida estrategias sobre histórico | No presenta un backtest como predicción |

La separación es deliberada: quien analiza no opera, y quien opera no decide el tamaño. Ninguno de los cuatro tiene acceso a `exchange_order`.

Cada uno lleva su skill: `market_analysis`, `risk_sizing`, `paper_execution` y `strategy_backtest`.

## Dimensionamiento por riesgo

El tamaño de una posición sale del riesgo que se acepta perder, no del dinero disponible:

```
riesgo_en_dinero  = equity × riesgo_por_operación   (1% por defecto)
distancia_al_stop = |entrada − stop|
tamaño            = riesgo_en_dinero ÷ distancia_al_stop
```

Con 10.000 USDT, riesgo del 1%, BTC en 72.450 y soporte en 70.900: se arriesgan 100 USDT, la distancia es 1.550, el tamaño es 0,0645 BTC y el notional 4.673 USDT. La posición mueve 4.673 pero sólo arriesga 100.

Si el stop que exige la estructura deja un notional por encima del límite, se **reduce el tamaño**; nunca se acerca el stop para que quepa.

## Backtesting

`backtest_run` soporta dos estrategias declarativas: `ema_cross` (cruce de medias) y `rsi_threshold` (cruce de umbrales de sobrecompra/sobreventa). Se describen con parámetros, no con código, para que el servidor no tenga que evaluar código generado por el modelo.

Todo resultado incluye la comparación contra **comprar y mantener**. Un +40% en un mercado que subió 80% destruyó valor, y el reporte lo dice en vez de celebrar el número absoluto. También declara sus limitaciones junto al resultado: sin slippage, una posición a la vez, sin cortos ni apalancamiento, y una ventana concreta de mercado.

## El servidor MCP

El vertical se expone además como servidor MCP independiente, que habla la revisión **2026-07-28** del protocolo:

```bash
bun run packages/mcp-trading/src/bin/http.ts    # Streamable HTTP en :8790
bun run packages/mcp-trading/src/bin/stdio.ts   # stdio, para Claude Code o Cursor
```

Qué implica esa revisión, y que se puede comprobar contra el servidor:

- **Sin handshake**: no hay `initialize`. Cada request lleva su versión y capabilities en `_meta`; un envelope incompleto se rechaza con `-32602`.
- **Sin sesiones**: desaparece `Mcp-Session-Id`. El estado del portafolio vive en el store, no en la conexión.
- **`server/discover`**: anuncia `supportedVersions: ["2026-07-28"]`, capabilities e identidad.
- **Resultados cacheables**: `tools/list` responde con `ttlMs` y `cacheScope: "public"`, porque la lista de tools es estática.
- **Compatibilidad**: el mismo endpoint sirve tráfico de la era 2025 por la ruta legacy, así que un cliente antiguo sigue funcionando.

Sampling, Roots y Logging quedaron deprecados en esa revisión y el servidor no los usa: los logs van a `stderr`.

## Una sola implementación, tres superficies

La lógica de trading vive una única vez, en `packages/mcp-trading/src/handlers.ts`. La envuelven tres superficies:

```
                    handlers.ts
                   (única lógica)
                         │
        ┌────────────────┼────────────────┐
        │                │                │
  servidor MCP     tools nativas     rutas /api/trading
  (clientes         (los agentes,      (la UI y la app
   externos)         en proceso)        de escritorio)
```

El motivo es concreto: si cada superficie tuviera su copia, el cálculo de un fill o de un guardrail podría divergir entre lo que reporta el agente en el chat y lo que muestra la pantalla. En un producto de trading eso no es aceptable.

`trading_focus` es la única excepción y a propósito: no es lógica de trading sino una directiva para la pantalla, así que no comparte handler y tampoco se expone por el servidor MCP — un cliente externo no tiene pantalla de hiveCrypto que enfocar.

## La pantalla

`/trading` tiene cinco pestañas:

- **Gráfico** — velas con Bollinger, EMAs, soportes y resistencias, y sub-paneles conmutables de volumen, RSI y MACD. Debajo, la fila de valores actuales de cada indicador con su lectura.
- **Simulación** — portafolio con equity y PnL, formulario de orden que muestra el límite mientras escribes, e historial con win rate, profit factor y drawdown máximo.
- **Screener** — qué se está moviendo, ordenable por variación o volumen. Un clic lleva el símbolo al gráfico.
- **Backtest** — parámetros, curva de equity y el veredicto contra comprar y mantener.
- **Auditoría** — cada intento de orden con su resultado y, si fue rechazado, el guardrail que lo bloqueó.

## La pantalla y el agente

Se hablan en las dos direcciones.

**De la pantalla al agente.** Cinco botones componen la frase con lo que la pantalla ya sabe
—símbolo, temporalidad, importe— y la mandan al coordinador: *Analizar con el agente* en la
cabecera, *Dimensionar* y *Delegar orden* en el formulario, *Interpretar* en el backtest y
*Revisar exposición* en el portafolio. La respuesta llega en un panel lateral que es la misma
conversación de `/chat`, no una aparte.

La diferencia entre «Comprar simulado» y «Delegar orden» importa: el primero manda la orden tal
cual, el segundo se la pasa al agente, que puede dimensionarla o avisarte de que la idea no tiene
stop.

**Del agente a la pantalla.** Al cerrar un análisis, el analista llama a `trading_focus` y la
pantalla ofrece seguirlo, con los niveles que encontró marcados en el gráfico. **No cambia el par
solo**: aparece un aviso «Seguir» y decides tú, salvo que lleves un rato sin tocar nada. Si el
símbolo cambiara bajo el cursor, el botón de comprar quedaría apuntando a otro activo del que
crees.

Mientras trabaja, la cabecera muestra qué especialista está activo y en qué herramienta va.

**En la conversación.** El agente puede dibujar un gráfico de velas dentro del chat con el
componente A2UI `Chart`, que reusa el mismo `CandlestickChart` de la pantalla — un máximo de 150
velas, porque el modelo de datos viaja entero por WebSocket en cada actualización.

El gráfico es SVG propio, sin librería de charting: el bundle se sirve desde el gateway local, donde una dependencia de CDN no cargaría, y así el tema claro/oscuro sale de las variables CSS del producto.

## Limitaciones conocidas

- **Sin cortos ni apalancamiento** en el motor de paper trading.
- **Una posición por símbolo y cuenta**; ampliar promedia la entrada.
- **El VWAP** es de la ventana solicitada, no de la sesión: una serie de velas cripto no tiene sesiones que reiniciar.
- **`arbitrage_scan` da el spread bruto**: no descuenta comisiones, retiros ni el tiempo de transferencia entre exchanges. Es una señal para investigar, no una oportunidad confirmada.
- **CCXT añade ~11,5 MB** al bundle a cambio de cobertura de 100+ exchanges.
