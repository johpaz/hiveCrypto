/**
 * Contexto compartido que las tools reciben por inyección.
 *
 * Existe para que las tools no importen singletons: el servidor construye un
 * contexto y lo pasa. Los tests construyen otro con dobles de prueba.
 */

import type { PolicyEngine } from "./policy.ts";
import type { PaperStore } from "./paper-engine.ts";

export interface TradingContext {
  policy: PolicyEngine;
  store: PaperStore;
  /** Exchange por defecto cuando la tool no recibe uno. */
  defaultExchange: string;
  /** Comisión simulada para paper trading (fracción: 0.001 = 0.1%). */
  feeRate: number;
}

/** Error de negocio: se devuelve al modelo como texto, no revienta el servidor. */
export class ToolError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
    this.name = "ToolError";
  }
}

/** Envoltorio de resultado: todas las tools devuelven texto + structuredContent. */
export function ok<T extends Record<string, unknown>>(data: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/** Resultado de error, marcado con isError para que el cliente lo distinga. */
export function fail(message: string, hint?: string) {
  const data = { ok: false as const, error: message, ...(hint ? { hint } : {}) };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    isError: true,
  };
}

/** Ejecuta un handler capturando errores y traduciéndolos a un resultado de error. */
export async function guard<T>(fn: () => Promise<T>): Promise<T | ReturnType<typeof fail>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ToolError) return fail(err.message, err.hint);
    const msg = err instanceof Error ? err.message : String(err);
    return fail(msg);
  }
}
