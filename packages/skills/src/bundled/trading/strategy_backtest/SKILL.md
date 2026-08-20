---
name: strategy_backtest
description: "Valida una estrategia sobre histórico y la compara contra comprar y mantener"
version: 1.0.0
author: hiveCrypto
icon: "🔬"
category: trading
permissions:
  - internet_access
dependencies: []
tools: [market_symbols, backtest_run, market_ohlcv, ta_indicators]

triggers:
  - "backtest"
  - "prueba la estrategia"
  - "qué habría pasado"
  - "funciona comprar cuando"
  - "valida esta idea"
  - "cruce de medias"
  - "sirve el rsi"

preferred_agents: [strategy_researcher]

steps:
  - step: 1
    action: backtest_run
    instruction: "Ejecuta la estrategia con los parámetros pedidos. Si la hipótesis del usuario no encaja en ema_cross ni rsi_threshold, dilo en vez de forzar una traducción que no representa su idea."
    output: base

  - step: 2
    action: backtest_run
    instruction: "Repite con parámetros vecinos (por ejemplo 15/45 y 25/55 si el original era 20/50). Si el resultado se desploma al mover un poco los parámetros, estaba sobreajustado."
    output: robustness
---

# Backtesting de estrategias

Un backtest responde qué habría pasado, no qué va a pasar. Toda la entrega debe respetar esa diferencia.

## La comparación que nunca falta

Un +40% suena bien hasta que se descubre que el activo subió 80% en la misma ventana: la estrategia destruyó valor frente a no hacer nada. **Siempre** compara contra comprar y mantener y di explícitamente si lo superó.

## Métricas y cómo leerlas

| Métrica | Lectura |
|---|---|
| Rendimiento vs. comprar y mantener | La única que decide si la estrategia aporta algo |
| Número de operaciones | Menos de ~20 cierres no permite concluir nada |
| Win rate | Alto con profit factor bajo = muchas ganancias pequeñas y pocas pérdidas enormes |
| Profit factor | Bajo 1 pierde dinero; sobre 1,5 empieza a ser interesante |
| Drawdown máximo | Cuánto habría que aguantar; si supera lo tolerable, la estrategia es inviable aunque sea rentable |

## Prueba de robustez

Una estrategia que rinde con 20/50 pero se derrumba con 18/48 no encontró una señal, encontró una casualidad. Corre siempre parámetros vecinos y reporta si el resultado se mantiene.

## Limitaciones que van en el cuerpo del reporte

No en una nota al pie:

- Sin slippage: las entradas y salidas asumen ejecución al cierre de la vela.
- Una sola posición a la vez, sin apalancamiento ni cortos.
- Una ventana concreta de mercado, con su régimen concreto.
- El rendimiento pasado no es predictivo.

## Reglas

- Nunca presentes un backtest como evidencia de rendimiento futuro.
- Si el resultado se apoya en pocas operaciones, dilo antes de dar cualquier número.
- Si la estrategia no supera a comprar y mantener, esa es la conclusión — no busques un ángulo para salvarla.
