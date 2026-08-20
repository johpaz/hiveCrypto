---
name: market_analysis
description: "Lectura completa de un mercado cripto: precio, estructura, indicadores técnicos y contexto de derivados"
version: 1.0.0
author: hiveCrypto
icon: "📈"
category: trading
permissions:
  - internet_access
dependencies: []
tools: [market_symbols, market_ticker, market_ohlcv, ta_indicators, ta_levels, market_trades, market_funding]

triggers:
  - "analiza"
  - "análisis de"
  - "cómo está"
  - "qué opinas de"
  - "revisa el mercado"
  - "lectura de"
  - "qué dice el rsi"
  - "soportes y resistencias"
  - "está sobrecomprado"
  - "está sobrevendido"

preferred_agents: [market_analyst]

steps:
  - step: 1
    action: market_symbols
    instruction: "Resuelve el símbolo exacto sólo si el usuario fue ambiguo (dijo 'bitcoin' en vez de 'BTC/USDT'). Si el símbolo ya viene explícito y bien formado, salta este paso."
    output: symbol

  - step: 2
    action: market_ticker
    instruction: "Trae precio actual, variación de 24h y volumen. Es el ancla de todo lo demás."
    output: ticker

  - step: 3
    action: ta_indicators
    instruction: "Calcula RSI, MACD y EMAs sobre el timeframe pedido. Si el usuario no indicó timeframe, usa 4h para lectura de swing y 1h si preguntó por el corto plazo."
    output: indicators

  - step: 4
    action: ta_levels
    instruction: "Ubica soporte y resistencia más cercanos al precio actual. Sin niveles concretos el análisis no sirve para decidir nada."
    output: levels

  - step: 5
    action: market_funding
    instruction: "Sólo si el símbolo es un perpetuo. Funding muy positivo indica exceso de largos apalancados. Si el par es spot, salta este paso sin comentarlo."
    output: derivatives
---

# Análisis de mercado

Entrega una lectura del mercado que sirva para tomar una decisión, no un resumen de números.

## Qué debe contener la entrega

1. **Dónde está el precio** — valor actual, variación de 24h y dónde queda respecto a las EMAs.
2. **Qué dice el momentum** — RSI con su interpretación, y si el MACD está a favor o en contra.
3. **Los niveles que importan** — soporte y resistencia más cercanos, con el precio numérico y cuántos toques tiene cada uno.
4. **El sesgo** — alcista, bajista o lateral, y qué tendría que pasar para invalidarlo.

## Cómo interpretar

- **RSI > 70**: sobrecompra. No es señal de venta por sí sola: en tendencia fuerte el RSI se queda alto mucho tiempo.
- **RSI < 30**: sobreventa. Mismo cuidado en sentido inverso.
- **MACD cruzando al alza** el histograma pasa de negativo a positivo: momentum girando a favor.
- **Precio sobre EMA200**: sesgo estructural alcista. Debajo, bajista.
- **Funding muy positivo**: los largos pagan a los cortos; hay apalancamiento alcista acumulado y riesgo de liquidaciones en cascada a la baja.

## Reglas

- Cada afirmación va con su número. "El RSI está alto" no sirve; "RSI 82, sobrecompra" sí.
- Distingue lo que observas de lo que interpretas.
- Nunca presentes la lectura como una predicción. El análisis describe el estado actual y sus escenarios, no el futuro.
- Si los indicadores se contradicen entre sí, dilo: es información, no un problema a esconder.
