---
name: paper_execution
description: "Ejecuta operaciones simuladas contra el libro real y reporta el fill con su slippage"
version: 1.0.0
author: hiveCrypto
icon: "🧪"
category: trading
permissions: []
dependencies: []
tools: [paper_account, market_orderbook, paper_order, paper_positions, paper_close, paper_history]

triggers:
  - "compra simulado"
  - "vende simulado"
  - "abre una posición"
  - "cierra la posición"
  - "orden de prueba"
  - "paper trade"
  - "mi portafolio"
  - "cuánto llevo"
  - "historial de operaciones"

preferred_agents: [paper_trader]

steps:
  - step: 1
    action: paper_account
    instruction: "Confirma que la cuenta existe y cuánto saldo tiene. Si no existe, créala con el saldo inicial por defecto y avisa que es nueva."
    output: account

  - step: 2
    action: market_orderbook
    instruction: "Mira la profundidad antes de enviar. Si el tamaño consume varios niveles, el slippage será notable y hay que anticiparlo."
    output: book

  - step: 3
    action: paper_order
    instruction: "Ejecuta la orden. Reporta SIEMPRE el precio de fill real que devuelve la tool, nunca el precio de referencia que viste antes."
    output: trade

  - step: 4
    action: paper_positions
    instruction: "Confirma el estado resultante de la posición tras la ejecución."
    output: position
---

# Ejecución simulada

Toda operación de esta skill es **simulada**. No toca fondos reales ni llega al exchange. Dilo en cada reporte: el usuario nunca debe dudar de si una orden fue real.

## Cómo se llena una orden

El fill recorre el libro de órdenes real nivel por nivel. Una compra consume las ofertas de venta empezando por la más barata; cuando el primer nivel se agota, pasa al siguiente, más caro. Por eso el precio promedio de una orden grande es peor que el precio que se ve en pantalla — eso es el **slippage**, y es real aunque la operación sea simulada.

## Qué reportar siempre

| Dato | Por qué importa |
|---|---|
| Precio de fill | Es el precio que realmente se pagó, no el de referencia |
| Slippage % | Mide cuánto costó el tamaño de la orden |
| Comisión | Se descuenta del saldo y erosiona el resultado |
| Saldo resultante | Estado real de la cuenta tras la operación |
| Llenado parcial | Si el libro no dio para todo, hay que decirlo |

## Situaciones que no se esconden

- **Llenado parcial**: si la liquidez no alcanzó, reporta la cantidad llenada frente a la pedida.
- **Rechazo de política**: si la orden superó el notional máximo o el símbolo no está en la whitelist, di cuál límite la bloqueó.
- **Saldo insuficiente**: reporta cuánto costaba la orden y cuánto había.

## Reglas

- No decides qué operar ni cuánto: eso lo dimensiona el gestor de riesgo. Tú ejecutas lo que ya viene dimensionado.
- No maquillas un resultado malo. Una pérdida se reporta con el mismo detalle que una ganancia.
- Al cerrar, reporta el PnL realizado en dinero y en porcentaje.
