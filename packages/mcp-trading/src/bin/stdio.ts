#!/usr/bin/env bun
/**
 * Servidor MCP de trading sobre stdio — para Claude Code, Cursor y clientes locales.
 *
 * stdout queda reservado para el protocolo: todo log va a stderr.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createFactory } from "../server.ts";

const { ctx, factory } = createFactory();

serveStdio(factory);

console.error(
  `[mcp-trading] stdio listo | TRADING_MODE=${ctx.policy.config.mode} | exchange=${ctx.defaultExchange}`
);
