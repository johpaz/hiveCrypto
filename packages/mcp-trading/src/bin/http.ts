#!/usr/bin/env bun
/**
 * Servidor MCP de trading sobre Streamable HTTP.
 *
 * `createMcpHandler` devuelve un objeto web-standard `{ fetch, close, notify, bus }`,
 * que es justo la forma que espera `Bun.serve` — no hace falta el adaptador de Node.
 */

import { createMcpHandler } from "@modelcontextprotocol/server";
import { createFactory } from "../server.ts";

const port = Number(process.env.MCP_TRADING_PORT ?? "8790");
const { ctx, factory } = createFactory();

const handler = createMcpHandler(factory, {
  // "stateless" mantiene atendido al cliente era-2025 de hive mientras migra.
  legacy: "stateless",
  onerror: err => console.error("[mcp-trading]", err.message),
});

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        server: "hivecrypto-trading",
        mode: ctx.policy.config.mode,
        defaultExchange: ctx.defaultExchange,
      });
    }
    return handler.fetch(req);
  },
});

// Los logs van a stderr: en la revisión 2026-07-28 la feature Logging está
// deprecada, y stdout debe quedar libre por si se sirve por stdio.
console.error(`[mcp-trading] escuchando en http://localhost:${server.port}/mcp`);
console.error(`[mcp-trading] TRADING_MODE=${ctx.policy.config.mode} | exchange=${ctx.defaultExchange}`);
console.error(`[mcp-trading] notional máximo por orden: ${ctx.policy.config.maxOrderNotional}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    handler.close();
    server.stop();
    process.exit(0);
  });
}
