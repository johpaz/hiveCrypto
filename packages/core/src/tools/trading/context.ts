/**
 * Contexto de trading compartido por las tools nativas y las rutas del gateway.
 *
 * Se construye una sola vez por proceso: el policy engine guarda el log de
 * auditoría en memoria y no debe reiniciarse en cada llamada.
 */

import { PolicyEngine, loadPolicyFromEnv } from "@johpaz/hivecrypto-mcp-trading/policy";
import type { TradingContext } from "@johpaz/hivecrypto-mcp-trading";
import { HiveDbPaperStore } from "./store.ts";

let _ctx: TradingContext | null = null;

export function getTradingContext(): TradingContext {
  if (!_ctx) {
    _ctx = {
      policy: new PolicyEngine(loadPolicyFromEnv()),
      store: new HiveDbPaperStore(),
      defaultExchange: process.env.DEFAULT_EXCHANGE ?? "binance",
      feeRate: Number(process.env.PAPER_FEE_RATE ?? "0.001"),
    };
  }
  return _ctx;
}

/** Sólo para tests: fuerza la reconstrucción del contexto. */
export function resetTradingContext(): void {
  _ctx = null;
}
