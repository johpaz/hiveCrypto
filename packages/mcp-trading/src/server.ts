/**
 * Servidor MCP de trading — revisión 2026-07-28.
 *
 * Sobre la era del protocolo: el SDK v2 no pone bytes de 2026-07-28 en el cable
 * por defecto (su LATEST_PROTOCOL_VERSION sigue siendo 2025-11-25). La era nueva
 * se sirve al entrar por `createMcpHandler`, que además atiende tráfico 2025 por
 * la ruta `legacy: "stateless"`. Por eso este servidor habla la revisión nueva y
 * el cliente era-2025 de hive lo sigue pudiendo usar sin cambios.
 *
 * Consecuencias de que el núcleo sea stateless, visibles en este diseño:
 *  - No hay `initialize` ni sesiones: cada request trae su versión y capabilities
 *    en `_meta`. La fábrica se invoca por request, así que NO puede haber estado
 *    en el closure del servidor — el estado del paper trading vive en el store.
 *  - Sampling, Roots y Logging están deprecados: no se usan. Los logs van a stderr.
 *  - Los resultados cacheables exigen ttlMs/cacheScope, que se configuran abajo.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { PolicyEngine, loadPolicyFromEnv, type PolicyConfig } from "./policy.ts";
import { InMemoryPaperStore, type PaperStore } from "./paper-engine.ts";
import type { TradingContext } from "./context.ts";
import { registerAllTools } from "./tools/register.ts";

export const SERVER_NAME = "hivecrypto-trading";
export const SERVER_VERSION = "0.1.0";

export interface BuildOptions {
  policy?: PolicyConfig;
  /** Store del paper trading. hiveCrypto inyecta uno respaldado en HiveDB. */
  store?: PaperStore;
  defaultExchange?: string;
  feeRate?: number;
}

/**
 * Contexto compartido entre invocaciones de la fábrica.
 *
 * `createMcpHandler` construye un McpServer nuevo por request (el modelo
 * stateless), pero el store y el log de auditoría deben sobrevivir entre
 * requests: si se crearan dentro de la fábrica, cada llamada empezaría con un
 * portafolio vacío. Por eso el contexto se construye una vez, fuera.
 */
export function buildContext(opts: BuildOptions = {}): TradingContext {
  return {
    policy: new PolicyEngine(opts.policy ?? loadPolicyFromEnv()),
    store: opts.store ?? new InMemoryPaperStore(),
    defaultExchange: opts.defaultExchange ?? process.env.DEFAULT_EXCHANGE ?? "binance",
    feeRate: opts.feeRate ?? Number(process.env.PAPER_FEE_RATE ?? "0.001"),
  };
}

/** Construye un McpServer con todas las tools registradas. */
export function buildServer(ctx: TradingContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      // Resultados cacheables de la revisión 2026-07-28. La lista de tools es
      // estática, así que se puede cachear con holgura y en scope público; eso
      // ahorra un round-trip por request y mejora el cache de prompt del cliente.
      cacheHints: {
        "tools/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "server/discover": { ttlMs: 3_600_000, cacheScope: "public" },
      },
    }
  );

  registerAllTools(server, ctx);

  return server;
}

/** Fábrica lista para `createMcpHandler` / `serveStdio`. */
export function createFactory(opts: BuildOptions = {}) {
  const ctx = buildContext(opts);
  return { ctx, factory: () => buildServer(ctx) };
}
