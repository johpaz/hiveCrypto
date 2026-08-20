/**
 * Tools de paper trading.
 *
 * Las órdenes se llenan contra el libro real del exchange (ver paper-engine),
 * así que el slippage refleja la liquidez que había en ese momento. Nada de
 * esto toca fondos reales ni llega al exchange.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getPublicExchange } from "../exchanges.ts";
import { type TradingContext, ToolError, ok, guard } from "../context.ts";
import {
  type PaperAccount, executeMarketOrder, performance,
} from "../paper-engine.ts";

const DEFAULT_ACCOUNT = "default";

async function loadAccount(ctx: TradingContext, id: string): Promise<PaperAccount> {
  const acc = await ctx.store.getAccount(id);
  if (!acc) {
    throw new ToolError(
      `No existe la cuenta paper "${id}"`,
      'Créala primero con paper_account { action: "create" }'
    );
  }
  return acc;
}

export function registerPaperTools(server: McpServer, ctx: TradingContext): void {
  server.registerTool(
    "paper_account",
    {
      title: "Cuenta de paper trading",
      description:
        "Crea o consulta una cuenta virtual de paper trading. Devuelve saldo, equity " +
        "(saldo + valor de mercado de las posiciones) y rendimiento total. " +
        "Spanish: cuenta demo, portafolio simulado, saldo virtual, cuánto tengo",
      inputSchema: z.object({
        action: z.enum(["create", "get"]).default("get"),
        accountId: z.string().default(DEFAULT_ACCOUNT),
        initialBalance: z.number().min(1).default(10_000)
          .describe("Saldo inicial al crear la cuenta"),
        quote: z.string().default("USDT").describe("Moneda de cotización de la cuenta"),
        exchange: z.string().default(ctx.defaultExchange)
          .describe("Exchange usado para valorar las posiciones abiertas"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ action, accountId, initialBalance, quote, exchange }) =>
      guard(async () => {
        let acc = await ctx.store.getAccount(accountId);

        if (action === "create") {
          if (acc) {
            throw new ToolError(
              `La cuenta "${accountId}" ya existe (saldo ${acc.balance.toFixed(2)} ${acc.quote})`,
              'Usa action:"get" para consultarla, o elige otro accountId'
            );
          }
          acc = {
            id: accountId, quote, balance: initialBalance,
            initialBalance, createdAt: new Date().toISOString(),
          };
          await ctx.store.putAccount(acc);
        }

        if (!acc) {
          throw new ToolError(
            `No existe la cuenta paper "${accountId}"`,
            'Créala con action:"create"'
          );
        }

        // Equity = saldo + valor de mercado de lo que está abierto.
        const positions = await ctx.store.listPositions(accountId);
        let positionsValue = 0;
        const valued = [];
        for (const p of positions) {
          let price: number | null = null;
          try {
            price = (await getPublicExchange(exchange).fetchTicker(p.symbol)).last ?? null;
          } catch {
            // Si el precio no se puede leer, la posición se valora a su entrada
            // y se marca, en vez de romper la consulta de la cuenta.
          }
          const mark = price ?? p.entryPrice;
          const value = mark * p.amount;
          positionsValue += value;
          valued.push({
            symbol: p.symbol, amount: p.amount, entryPrice: p.entryPrice,
            markPrice: mark, priceStale: price === null,
            value, unrealizedPnl: (mark - p.entryPrice) * p.amount,
            unrealizedPnlPct: ((mark - p.entryPrice) / p.entryPrice) * 100,
          });
        }

        const equity = acc.balance + positionsValue;
        return ok({
          account: acc,
          equity,
          positionsValue,
          totalReturn: equity - acc.initialBalance,
          totalReturnPct: ((equity - acc.initialBalance) / acc.initialBalance) * 100,
          positions: valued,
        });
      })
  );

  server.registerTool(
    "paper_order",
    {
      title: "Orden simulada",
      description:
        "Ejecuta una orden de mercado SIMULADA contra el libro de órdenes real. " +
        "No toca fondos reales ni llega al exchange. El fill recorre los niveles del " +
        "libro, así que el precio promedio incluye slippage real. " +
        "Spanish: comprar simulado, vender simulado, orden de prueba, paper trade",
      inputSchema: z.object({
        symbol: z.string().describe('Símbolo, por ejemplo "BTC/USDT"'),
        side: z.enum(["buy", "sell"]),
        amount: z.number().positive().optional()
          .describe("Cantidad en la moneda base. Alternativa a notional."),
        notional: z.number().positive().optional()
          .describe("Importe en la moneda de cotización. Se convierte a cantidad al precio actual."),
        accountId: z.string().default(DEFAULT_ACCOUNT),
        exchange: z.string().default(ctx.defaultExchange),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ symbol, side, amount, notional, accountId, exchange }) =>
      guard(async () => {
        if (!amount && !notional) {
          throw new ToolError("Falta amount o notional", "Indica uno de los dos para dimensionar la orden");
        }

        const acc = await loadAccount(ctx, accountId);
        const ex = getPublicExchange(exchange);
        const book = await ex.fetchOrderBook(symbol, 50);

        // Referencia para convertir notional→cantidad y para valorar el guardrail.
        const reference = side === "buy" ? book.asks?.[0]?.[0] : book.bids?.[0]?.[0];
        if (!reference) throw new ToolError(`El libro de ${symbol} en ${exchange} vino vacío`);

        const qty = amount ?? notional! / reference;
        const estNotional = qty * reference;

        const decision = ctx.policy.checkPaperOrder({ exchange, symbol, notional: estNotional });
        ctx.policy.record({
          action: "paper_order", exchange, symbol, side,
          amount: qty, price: reference, notional: estNotional,
          allowed: decision.allowed, reason: decision.reason,
        });
        if (!decision.allowed) throw new ToolError(`Orden rechazada por política: ${decision.reason}`);

        const position = await ctx.store.getPosition(accountId, symbol);
        const result = executeMarketOrder(
          { account: acc, symbol, side, amount: qty, book, feeRate: ctx.feeRate },
          position
        );

        await ctx.store.putAccount(result.account);
        if (result.position) await ctx.store.putPosition(result.position);
        else await ctx.store.deletePosition(accountId, symbol);
        await ctx.store.appendTrade(result.trade);

        return ok({
          simulated: true,
          trade: result.trade,
          balance: result.account.balance,
          position: result.position,
          requestedAmount: qty,
          filledAmount: result.trade.amount,
          partialFill: result.trade.amount < qty - 1e-12,
        });
      })
  );

  server.registerTool(
    "paper_positions",
    {
      title: "Posiciones abiertas",
      description:
        "Posiciones abiertas de una cuenta paper con su PnL no realizado, valoradas " +
        "al precio de mercado actual. " +
        "Spanish: mis posiciones, qué tengo abierto, ganancia no realizada",
      inputSchema: z.object({
        accountId: z.string().default(DEFAULT_ACCOUNT),
        exchange: z.string().default(ctx.defaultExchange),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, exchange }) =>
      guard(async () => {
        await loadAccount(ctx, accountId);
        const positions = await ctx.store.listPositions(accountId);
        const ex = getPublicExchange(exchange);

        const rows = [];
        let totalUnrealized = 0;
        for (const p of positions) {
          let price: number | null = null;
          try { price = (await ex.fetchTicker(p.symbol)).last ?? null; } catch { /* precio no disponible */ }
          const mark = price ?? p.entryPrice;
          const pnl = (mark - p.entryPrice) * p.amount;
          totalUnrealized += pnl;
          rows.push({
            symbol: p.symbol, amount: p.amount, entryPrice: p.entryPrice,
            markPrice: mark, priceStale: price === null,
            value: mark * p.amount, unrealizedPnl: pnl,
            unrealizedPnlPct: ((mark - p.entryPrice) / p.entryPrice) * 100,
            openedAt: p.openedAt,
          });
        }

        return ok({ accountId, count: rows.length, totalUnrealizedPnl: totalUnrealized, positions: rows });
      })
  );

  server.registerTool(
    "paper_close",
    {
      title: "Cerrar posición simulada",
      description:
        "Cierra una posición paper vendiendo toda la cantidad a mercado contra el libro real. " +
        "Devuelve el PnL realizado. " +
        "Spanish: cerrar posición, vender todo, liquidar",
      inputSchema: z.object({
        symbol: z.string(),
        accountId: z.string().default(DEFAULT_ACCOUNT),
        exchange: z.string().default(ctx.defaultExchange),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ symbol, accountId, exchange }) =>
      guard(async () => {
        const acc = await loadAccount(ctx, accountId);
        const position = await ctx.store.getPosition(accountId, symbol);
        if (!position || position.amount <= 0) {
          throw new ToolError(`No hay posición abierta en ${symbol} en la cuenta "${accountId}"`);
        }

        const book = await getPublicExchange(exchange).fetchOrderBook(symbol, 50);
        const result = executeMarketOrder(
          { account: acc, symbol, side: "sell", amount: position.amount, book, feeRate: ctx.feeRate },
          position
        );

        ctx.policy.record({
          action: "paper_close", exchange, symbol, side: "sell",
          amount: result.trade.amount, price: result.trade.price,
          notional: result.trade.notional, allowed: true,
        });

        await ctx.store.putAccount(result.account);
        if (result.position) await ctx.store.putPosition(result.position);
        else await ctx.store.deletePosition(accountId, symbol);
        await ctx.store.appendTrade(result.trade);

        return ok({
          simulated: true,
          closed: !result.position,
          trade: result.trade,
          realizedPnl: result.trade.realizedPnl ?? 0,
          balance: result.account.balance,
          remaining: result.position,
        });
      })
  );

  server.registerTool(
    "paper_history",
    {
      title: "Historial y métricas",
      description:
        "Historial de operaciones simuladas de una cuenta con sus métricas: win rate, " +
        "PnL total, profit factor, drawdown máximo y ganancia/pérdida promedio. " +
        "Spanish: historial, resultados, estadísticas, cómo me fue, win rate",
      inputSchema: z.object({
        accountId: z.string().default(DEFAULT_ACCOUNT),
        limit: z.number().int().min(1).max(1000).default(100),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, limit }) =>
      guard(async () => {
        const acc = await loadAccount(ctx, accountId);
        const trades = await ctx.store.listTrades(accountId, limit);
        return ok({
          accountId,
          balance: acc.balance,
          initialBalance: acc.initialBalance,
          metrics: performance(trades),
          trades,
        });
      })
  );
}
