/**
 * Tools que tocan la cuenta real del exchange — SIEMPRE en sandbox/testnet.
 *
 * Requieren TRADING_MODE=testnet y credenciales de testnet en el entorno.
 * `getPrivateExchange` fuerza `setSandboxMode(true)` y verifica el resultado,
 * y `assertSandbox` lo revalida justo antes de cada orden. No existe ninguna
 * ruta en este archivo que pueda operar contra producción.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getPrivateExchange, credentialsFromEnv, assertSandbox } from "../exchanges.ts";
import { type TradingContext, ToolError, ok, guard } from "../context.ts";

/** Resuelve la instancia privada en sandbox o explica por qué no se puede. */
function privateExchange(ctx: TradingContext, id: string) {
  if (ctx.policy.config.mode !== "testnet") {
    throw new ToolError(
      `TRADING_MODE="${ctx.policy.config.mode}": las tools de exchange requieren modo "testnet"`,
      'Usa las tools paper_* para simular, o arranca el servidor con TRADING_MODE=testnet'
    );
  }
  const creds = credentialsFromEnv(id);
  if (!creds) {
    throw new ToolError(
      `Faltan credenciales de testnet para "${id}"`,
      `Define ${id.toUpperCase()}_API_KEY y ${id.toUpperCase()}_SECRET con llaves del TESTNET, nunca de producción`
    );
  }
  return getPrivateExchange(id, creds);
}

export function registerExchangeTools(server: McpServer, ctx: TradingContext): void {
  server.registerTool(
    "exchange_balance",
    {
      title: "Saldo en testnet",
      description:
        "Saldo de la cuenta en el TESTNET del exchange. Requiere TRADING_MODE=testnet " +
        "y credenciales de testnet. Nunca consulta una cuenta de producción. " +
        "Spanish: saldo real, balance de la cuenta, cuánto hay en el exchange",
      inputSchema: z.object({
        exchange: z.string().default(ctx.defaultExchange),
        hideZero: z.boolean().default(true).describe("Ocultar monedas con saldo cero"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ exchange, hideZero }) =>
      guard(async () => {
        const ex = privateExchange(ctx, exchange);
        assertSandbox(ex, exchange);
        const bal = await ex.fetchBalance();

        const rows = Object.entries(bal.total ?? {})
          .map(([currency, total]) => ({
            currency,
            total: Number(total) || 0,
            free: Number(bal.free?.[currency]) || 0,
            used: Number(bal.used?.[currency]) || 0,
          }))
          .filter(r => (hideZero ? r.total > 0 : true));

        return ok({ exchange, sandbox: true, count: rows.length, balances: rows });
      })
  );

  server.registerTool(
    "exchange_order",
    {
      title: "Orden en testnet",
      description:
        "Coloca una orden en el TESTNET del exchange (fondos de prueba, nunca dinero real). " +
        "Requiere TRADING_MODE=testnet y pasa por los guardrails de whitelist y notional máximo. " +
        "Spanish: orden real de prueba, comprar en testnet, colocar orden",
      inputSchema: z.object({
        symbol: z.string(),
        side: z.enum(["buy", "sell"]),
        type: z.enum(["market", "limit"]).default("market"),
        amount: z.number().positive().describe("Cantidad en la moneda base"),
        price: z.number().positive().optional().describe("Precio límite. Obligatorio si type=limit."),
        exchange: z.string().default(ctx.defaultExchange),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ symbol, side, type, amount, price, exchange }) =>
      guard(async () => {
        if (type === "limit" && !price) {
          throw new ToolError("Una orden limit necesita price");
        }

        const ex = privateExchange(ctx, exchange);
        // Segunda verificación, justo antes de enviar: si algo dejó la instancia
        // fuera de sandbox entre la construcción y ahora, aquí se detiene.
        assertSandbox(ex, exchange);

        // El notional se estima con el precio límite o con el último de mercado.
        let reference = price;
        if (!reference) {
          const t = await ex.fetchTicker(symbol);
          reference = t.last ?? undefined;
        }
        if (!reference) throw new ToolError(`No se pudo estimar el precio de ${symbol} para validar la orden`);

        const notional = amount * reference;
        const decision = ctx.policy.checkExchangeOrder({ exchange, symbol, notional });
        ctx.policy.record({
          action: "exchange_order", exchange, symbol, side, amount,
          price: reference, notional,
          allowed: decision.allowed, reason: decision.reason,
        });
        if (!decision.allowed) throw new ToolError(`Orden rechazada por política: ${decision.reason}`);

        const order = await ex.createOrder(symbol, type, side, amount, price);
        return ok({
          sandbox: true,
          exchange,
          order: {
            id: order.id, symbol: order.symbol, side: order.side, type: order.type,
            amount: order.amount, price: order.price ?? null,
            status: order.status ?? null, filled: order.filled ?? null,
            timestamp: order.timestamp ?? null,
          },
        });
      })
  );

  server.registerTool(
    "exchange_orders",
    {
      title: "Órdenes abiertas en testnet",
      description:
        "Lista o cancela órdenes abiertas en el TESTNET del exchange. " +
        "Spanish: órdenes abiertas, cancelar orden, qué tengo pendiente",
      inputSchema: z.object({
        action: z.enum(["list", "cancel"]).default("list"),
        symbol: z.string().optional().describe("Filtra por símbolo. Obligatorio para cancelar."),
        orderId: z.string().optional().describe("Id de la orden a cancelar"),
        exchange: z.string().default(ctx.defaultExchange),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ action, symbol, orderId, exchange }) =>
      guard(async () => {
        const ex = privateExchange(ctx, exchange);
        assertSandbox(ex, exchange);

        if (action === "cancel") {
          if (!orderId || !symbol) {
            throw new ToolError("Para cancelar hacen falta orderId y symbol");
          }
          const res = await ex.cancelOrder(orderId, symbol);
          ctx.policy.record({ action: "exchange_cancel", exchange, symbol, allowed: true });
          return ok({ sandbox: true, cancelled: true, orderId, symbol, result: res?.status ?? "ok" });
        }

        const orders = await ex.fetchOpenOrders(symbol);
        return ok({
          sandbox: true,
          exchange,
          count: orders.length,
          orders: orders.map((o: any) => ({
            id: o.id, symbol: o.symbol, side: o.side, type: o.type,
            amount: o.amount, price: o.price ?? null,
            filled: o.filled ?? null, status: o.status ?? null,
            timestamp: o.timestamp ?? null,
          })),
        });
      })
  );
}
