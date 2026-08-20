/**
 * Rutas de trading para la UI y la app de escritorio.
 *
 * Delegan en los mismos handlers que usan las tools nativas y el servidor MCP,
 * así que la UI ve exactamente los mismos números que el agente. Si la lógica
 * cambia, cambia en los tres sitios a la vez porque sólo hay una copia.
 *
 * Un solo endpoint despacha por acción para no multiplicar rutas: la UI manda
 * { action, params } y recibe { ok, ...datos }.
 */

import { handlers, ToolError } from "@johpaz/hivecrypto-mcp-trading";
import { getTradingContext } from "../../tools/trading/context.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("trading-api");

type Handler = (ctx: any, params: any) => Promise<unknown>;

/**
 * Acciones expuestas a la UI.
 *
 * `exchange_order` y `exchange_orders` quedan deliberadamente FUERA: colocar
 * órdenes en el exchange, aunque sea testnet, se hace por el agente o por la
 * tool, no por un fetch desde el navegador. La UI es para ver y simular.
 */
const ACTIONS: Record<string, Handler> = {
  ticker: handlers.marketTicker,
  ohlcv: handlers.marketOhlcv,
  orderbook: handlers.marketOrderbook,
  trades: handlers.marketTrades,
  symbols: handlers.marketSymbols,
  funding: handlers.marketFunding,
  indicators: handlers.taIndicators,
  levels: handlers.taLevels,
  scan: handlers.scanMarkets,
  arbitrage: handlers.arbitrageScan,
  account: handlers.paperAccount,
  order: handlers.paperOrder,
  positions: handlers.paperPositions,
  close: handlers.paperClose,
  history: handlers.paperHistory,
  backtest: handlers.backtestRun,
};

/** Valores por defecto por acción: la UI manda sólo lo que el usuario eligió. */
function withDefaults(action: string, p: Record<string, unknown>, defaultExchange: string) {
  const exchange = typeof p.exchange === "string" && p.exchange ? p.exchange : defaultExchange;
  const accountId = typeof p.accountId === "string" && p.accountId ? p.accountId : "default";

  switch (action) {
    case "ticker": return { symbol: p.symbol, exchange };
    case "ohlcv": return { symbol: p.symbol, timeframe: p.timeframe ?? "1h", limit: p.limit ?? 200, exchange };
    case "orderbook": return { symbol: p.symbol, depth: p.depth ?? 20, exchange };
    case "trades": return { symbol: p.symbol, limit: p.limit ?? 50, exchange };
    case "symbols": return { query: p.query, type: p.type ?? "spot", limit: p.limit ?? 50, exchange };
    case "funding": return { symbol: p.symbol, exchange };
    case "indicators": return {
      symbol: p.symbol, timeframe: p.timeframe ?? "1h",
      indicators: p.indicators ?? ["rsi", "macd", "ema", "bollinger"],
      limit: p.limit ?? 200, emaPeriods: p.emaPeriods ?? [20, 50, 200],
      rsiPeriod: p.rsiPeriod ?? 14, exchange,
      // La UI dibuja las series, así que siempre las necesita.
      includeSeries: p.includeSeries ?? true,
    };
    case "levels": return { symbol: p.symbol, timeframe: p.timeframe ?? "4h", limit: p.limit ?? 300, lookback: p.lookback ?? 3, exchange };
    case "scan": return {
      quote: p.quote ?? "USDT", minQuoteVolume: p.minQuoteVolume ?? 1_000_000,
      sortBy: p.sortBy ?? "changePct", direction: p.direction ?? "desc",
      limit: p.limit ?? 20, exchange,
    };
    case "arbitrage": return { symbol: p.symbol, exchanges: p.exchanges ?? ["binance", "kraken", "okx"] };
    case "account": return {
      action: p.action ?? "get", accountId,
      initialBalance: p.initialBalance ?? 10_000, quote: p.quote ?? "USDT", exchange,
    };
    case "order": return { symbol: p.symbol, side: p.side, amount: p.amount, notional: p.notional, accountId, exchange };
    case "positions": return { accountId, exchange };
    case "close": return { symbol: p.symbol, accountId, exchange };
    case "history": return { accountId, limit: p.limit ?? 100 };
    case "backtest": return {
      symbol: p.symbol, strategy: p.strategy ?? "ema_cross", timeframe: p.timeframe ?? "1h",
      limit: p.limit ?? 500, initialBalance: p.initialBalance ?? 10_000, feeRate: p.feeRate ?? 0.001,
      fastPeriod: p.fastPeriod ?? 20, slowPeriod: p.slowPeriod ?? 50, rsiPeriod: p.rsiPeriod ?? 14,
      rsiBuyBelow: p.rsiBuyBelow ?? 30, rsiSellAbove: p.rsiSellAbove ?? 70,
      useSma: p.useSma ?? false, exchange,
    };
    default: return p;
  }
}

export async function handleTradingAction(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  const body = await req.json().catch(() => ({} as any));
  const action = String(body?.action ?? "");
  const handler = ACTIONS[action];

  if (!handler) {
    return addCorsHeaders(
      Response.json(
        { ok: false, error: `Acción desconocida: "${action}"`, available: Object.keys(ACTIONS) },
        { status: 400 }
      ),
      req
    );
  }

  const ctx = getTradingContext();
  const params = withDefaults(action, body?.params ?? {}, ctx.defaultExchange);

  try {
    const data = await handler(ctx, params);
    return addCorsHeaders(Response.json({ ok: true, ...(data as object) }), req);
  } catch (err) {
    if (err instanceof ToolError) {
      // Error de negocio (símbolo inexistente, saldo insuficiente, guardrail):
      // 400 y el mensaje tal cual, que es informativo para el usuario.
      return addCorsHeaders(
        Response.json({ ok: false, error: err.message, hint: err.hint }, { status: 400 }),
        req
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[trading] ${action} falló: ${msg}`);
    return addCorsHeaders(Response.json({ ok: false, error: msg }, { status: 500 }), req);
  }
}

/** Estado del motor: modo, límites y log de auditoría. Alimenta la cabecera de la UI. */
export async function handleTradingStatus(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  const ctx = getTradingContext();
  const url = new URL(req.url);
  const auditLimit = Number(url.searchParams.get("audit") ?? "20");

  return addCorsHeaders(
    Response.json({
      ok: true,
      mode: ctx.policy.config.mode,
      defaultExchange: ctx.defaultExchange,
      feeRate: ctx.feeRate,
      limits: {
        maxOrderNotional: ctx.policy.config.maxOrderNotional,
        symbolWhitelist: ctx.policy.config.symbolWhitelist,
        exchangeWhitelist: ctx.policy.config.exchangeWhitelist,
      },
      // Que la UI pueda mostrar por qué se rechazó una orden es parte del punto
      // de tener guardrails: si el rechazo es invisible, parece un bug.
      audit: ctx.policy.getAudit(auditLimit),
    }),
    req
  );
}
