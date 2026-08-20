---
name: risk_sizing
description: "Dimensiona una posición a partir del riesgo asumido y la distancia al stop, no del capital disponible"
version: 1.0.0
author: hiveCrypto
icon: "🛡️"
category: trading
permissions: []
dependencies: []
tools: [paper_account, paper_positions, ta_levels, ta_indicators, market_ticker]

triggers:
  - "cuánto invierto"
  - "cuánto debería"
  - "dónde pongo el stop"
  - "dimensiona"
  - "tamaño de posición"
  - "qué riesgo tengo"
  - "revisa mi exposición"
  - "cuánto arriesgo"

preferred_agents: [risk_manager]

steps:
  - step: 1
    action: paper_account
    instruction: "Trae el equity real de la cuenta. El tamaño se calcula sobre el equity, nunca sobre una cifra que el usuario mencione de memoria."
    output: account

  - step: 2
    action: paper_positions
    instruction: "Revisa qué hay abierto. Una posición nueva se suma a la exposición existente, no se evalúa aislada."
    output: exposure

  - step: 3
    action: ta_levels
    instruction: "Ubica el soporte relevante debajo del precio: es el candidato natural a nivel de invalidación."
    output: levels

  - step: 4
    action: ta_indicators
    instruction: "Calcula ATR para conocer la volatilidad. Un stop más ajustado que el ATR se ejecuta por ruido, no por invalidación."
    output: volatility
---

# Dimensionamiento por riesgo

El tamaño de una posición sale del riesgo que se acepta perder, no del dinero que hay en la cuenta.

## La fórmula

```
riesgo_en_dinero = equity × riesgo_por_operación
distancia_al_stop = |precio_entrada − precio_stop|
tamaño = riesgo_en_dinero ÷ distancia_al_stop
notional = tamaño × precio_entrada
```

`riesgo_por_operación` por defecto es **1% del equity**. Nunca propongas más del 2% sin que el usuario lo pida explícitamente.

## Ejemplo trabajado

Equity 10.000 USDT, riesgo 1%, BTC a 72.450, soporte en 70.900.

- Riesgo en dinero: `10.000 × 0,01 = 100 USDT`
- Distancia al stop: `72.450 − 70.900 = 1.550`
- Tamaño: `100 ÷ 1.550 = 0,0645 BTC`
- Notional: `0,0645 × 72.450 = 4.673 USDT`

La posición mueve 4.673 USDT pero sólo arriesga 100. Esa es la diferencia entre dimensionar por riesgo y dimensionar por capital.

## Dónde va el stop

- **Debajo del soporte**, no encima: si el nivel se pierde, la idea está invalidada.
- **Más lejos que un ATR** del precio de entrada. Un stop dentro del ruido diario se ejecuta por volatilidad normal, no porque la tesis fallara.
- Si el stop que exige la estructura deja un notional que supera los límites de la política, **reduce el tamaño**; nunca acerques el stop para que quepa.

## Relación riesgo-beneficio

Calcula siempre `(objetivo − entrada) ÷ (entrada − stop)`. Por debajo de 1,5 la operación necesita un porcentaje de acierto alto para ser rentable — dilo abiertamente en vez de dejarlo pasar.

## Reglas

- Nunca propongas una operación sin nivel de invalidación.
- Si la exposición ya abierta más la nueva concentra demasiado en un solo activo, adviértelo.
- Si el resultado no pasa los límites configurados, rechaza la operación y explica cuál límite la bloquea.
