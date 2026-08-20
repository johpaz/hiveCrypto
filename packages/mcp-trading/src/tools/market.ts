/**
 * Tools de datos de mercado — todas públicas, sin credenciales.
 *
 * Usan la instancia pública de CCXT, que apunta a producción: los datos del
 * testnet no reflejan el mercado real y no sirven para analizar nada.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getPublicExchange } from "../exchanges.ts";
import { type TradingContext, ToolError, ok, guard } from "../context.ts";

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;

const exchangeArg = (def: string) =>
  z.string().default(def).describe("Id del exchange en CCXT (binance, bybit, okx, kraken, coinbase...)");

const symbolArg = z.string().describe('Símbolo unificado de CCXT, por ejemplo "BTC/USDT"');

/** Comprueba la política de lectura y devuelve la instancia pública. */
function publicExchange(ctx: TradingContext, id: string) {
  const decision = ctx.policy.checkRead(id);
  if (!decision.allowed) throw new ToolError(decision.reason!);
  return getPublicExchange(id);
}

export function registerMarketTools(server: McpServer, ctx: TradingContext): void {
  server.registerTool(
    "market_ticker",
    {
      title: "Ticker de mercado",
      description:
        "Precio actual y estadísticas de 24h de un símbolo en un exchange. " +
        "Devuelve last, bid, ask, volumen y variación porcentual. " +
        "Spanish: precio de, cotización, cuánto vale, a cómo está",
      inputSchema: z.object({
        symbol: symbolArg,
        exchange: exchangeArg(ctx.defaultExchange),
      }),
      outputSchema: z.object({
        exchange: z.string(),
        symbol: z.string(),
        last: z.number().nullable(),
        bid: z.number().nullable(),
        ask: z.number().nullable(),
        high24h: z.number().nullable(),
        low24h: z.number().nullable(),
        baseVolume: z.number().nullable(),
        quoteVolume: z.number().nullable(),
        changePct24h: z.number().nullable(),
        timestamp: z.number().nullable(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ symbol, exchange }) =>
      guard(async () => {
        const ex = publicExchange(ctx, exchange);
        const t = await ex.fetchTicker(symbol);
        return ok({
          exchange,
          symbol,
          last: t.last ?? null,
          bid: t.bid ?? null,
          ask: t.ask ?? null,
          high24h: t.high ?? null,
          low24h: t.low ?? null,
          baseVolume: t.baseVolume ?? null,
          quoteVolume: t.quoteVolume ?? null,
          changePct24h: t.percentage ?? null,
          timestamp: t.timestamp ?? null,
        });
      })
  );

  server.registerTool(
    "market_ohlcv",
    {
      title: "Velas OHLCV",
      description:
        "Serie de velas (candlesticks) de un símbolo. Devuelve [timestamp, open, high, low, close, volume]. " +
        "Es la entrada de ta_indicators y backtest_run. " +
        "Spanish: velas, gráfico, histórico de precios, candlestick",
      inputSchema: z.object({
        symbol: symbolArg,
        timeframe: z.enum(TIMEFRAMES).default("1h").describe("Intervalo de cada vela"),
        limit: z.number().int().min(1).max(1000).default(100).describe("Número de velas (máx. 1000)"),
        exchange: exchangeArg(ctx.defaultExchange),
      }),
      outputSchema: z.object({
        exchange: z.string(),
        symbol: z.string(),
        timeframe: z.string(),
        count: z.number(),
        candles: z.array(z.array(z.number())),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ symbol, timeframe, limit, exchange }) =>
      guard(async () => {
        const ex = publicExchange(ctx, exchange);
        if (!ex.has?.fetchOHLCV) throw new ToolError(`El exchange "${exchange}" no expone OHLCV`);
        const candles = await ex.fetchOHLCV(symbol, timeframe, undefined, limit);
        return ok({ exchange, symbol, timeframe, count: candles.length, candles });
      })
  );

  server.registerTool(
    "market_orderbook",
    {
      title: "Libro de órdenes",
      description:
        "Profundidad L2 del libro: bids y asks con precio y cantidad. " +
        "Es lo que usa paper_order para calcular el slippage real. " +
        "Spanish: libro de órdenes, profundidad, order book, liquidez",
      inputSchema: z.object({
        symbol: symbolArg,
        depth: z.number().int().min(1).max(100).default(20).describe("Niveles por lado"),
        exchange: exchangeArg(ctx.defaultExchange),
      }),
      outputSchema: z.object({
        exchange: z.string(),
        symbol: z.string(),
        bids: z.array(z.array(z.number())),
        asks: z.array(z.array(z.number())),
        spread: z.number().nullable(),
        spreadPct: z.number().nullable(),
        timestamp: z.number().nullable(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ symbol, depth, exchange }) =>
      guard(async () => {
        const ex = publicExchange(ctx, exchange);
        const book = await ex.fetchOrderBook(symbol, depth);
        const bestBid = book.bids?.[0]?.[0] ?? null;
        const bestAsk = book.asks?.[0]?.[0] ?? null;
        const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
        return ok({
          exchange,
          symbol,
          bids: book.bids ?? [],
          asks: book.asks ?? [],
          spread,
          spreadPct: spread !== null && bestBid ? (spread / bestBid) * 100 : null,
          timestamp: book.timestamp ?? null,
        });
      })
  );

  server.registerTool(
    "market_trades",
    {
      title: "Operaciones recientes",
      description:
        "Últimas operaciones ejecutadas en el mercado, con precio, cantidad y lado. " +
        "Sirve para ver hacia dónde está presionando el flujo. " +
        "Spanish: trades recientes, operaciones, flujo de órdenes",
      inputSchema: z.object({
        symbol: symbolArg,
        limit: z.number().int().min(1).max(500).default(50),
        exchange: exchangeArg(ctx.defaultExchange),
      }),
      outputSchema: z.object({
        exchange: z.string(),
        symbol: z.string(),
        count: z.number(),
        buyVolume: z.number(),
        sellVolume: z.number(),
        trades: z.array(z.object({
          ts: z.number().nullable(),
          price: z.number(),
          amount: z.number(),
          side: z.string().nullable(),
        })),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ symbol, limit, exchange }) =>
      guard(async () => {
        const ex = publicExchange(ctx, exchange);
        const raw = await ex.fetchTrades(symbol, undefined, limit);
        const trades = raw.map((t: any) => ({
          ts: t.timestamp ?? null,
          price: t.price,
          amount: t.amount,
          side: t.side ?? null,
        }));
        const buyVolume = trades.filter(t => t.side === "buy").reduce((s, t) => s + t.amount, 0);
        const sellVolume = trades.filter(t => t.side === "sell").reduce((s, t) => s + t.amount, 0);
        return ok({ exchange, symbol, count: trades.length, buyVolume, sellVolume, trades });
      })
  );

  server.registerTool(
    "market_symbols",
    {
      title: "Buscar símbolos",
      description:
        "Lista o busca los mercados disponibles en un exchange. " +
        "Úsala cuando no sepas el símbolo exacto antes de llamar a las demás tools. " +
        "Spanish: buscar par, qué símbolos hay, mercados disponibles",
      inputSchema: z.object({
        query: z.string().optional().describe('Filtro por texto, por ejemplo "BTC" o "/USDT"'),
        type: z.enum(["spot", "swap", "future", "all"]).default("spot").describe("Tipo de mercado"),
        limit: z.number().int().min(1).max(200).default(50),
        exchange: exchangeArg(ctx.defaultExchange),
      }),
      outputSchema: z.object({
        exchange: z.string(),
        total: z.number(),
        count: z.number(),
        symbols: z.array(z.object({
          symbol: z.string(),
          base: z.string(),
          quote: z.string(),
          type: z.string().nullable(),
          active: z.boolean().nullable(),
        })),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, type, limit, exchange }) =>
      guard(async () => {
        const ex = publicExchange(ctx, exchange);
        const markets = await ex.loadMarkets();
        let list = Object.values(markets) as any[];
        if (type !== "all") list = list.filter(m => m.type === type);
        if (query) {
          const q = query.toUpperCase();
          list = list.filter(m => m.symbol?.toUpperCase().includes(q));
        }
        const total = list.length;
        return ok({
          exchange,
          total,
          count: Math.min(total, limit),
          symbols: list.slice(0, limit).map(m => ({
            symbol: m.symbol,
            base: m.base,
            quote: m.quote,
            type: m.type ?? null,
            active: m.active ?? null,
          })),
        });
      })
  );

  server.registerTool(
    "market_funding",
    {
      title: "Funding y open interest",
      description:
        "Tasa de financiación y open interest de un contrato perpetuo. " +
        "Funding positivo = los largos pagan a los cortos (sesgo alcista saturado). " +
        "Spanish: funding rate, tasa de financiación, interés abierto, perpetuos",
      inputSchema: z.object({
        symbol: z.string().describe('Símbolo del perpetuo, por ejemplo "BTC/USDT:USDT"'),
        exchange: exchangeArg(ctx.defaultExchange),
      }),
      outputSchema: z.object({
        exchange: z.string(),
        symbol: z.string(),
        fundingRate: z.number().nullable(),
        fundingRatePct: z.number().nullable(),
        nextFundingTime: z.number().nullable(),
        openInterest: z.number().nullable(),
        markPrice: z.number().nullable(),
        indexPrice: z.number().nullable(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ symbol, exchange }) =>
      guard(async () => {
        const ex = publicExchange(ctx, exchange);
        if (!ex.has?.fetchFundingRate) {
          throw new ToolError(
            `El exchange "${exchange}" no expone funding rate`,
            "El funding sólo existe en contratos perpetuos; prueba con un símbolo tipo BTC/USDT:USDT"
          );
        }
        const fr = await ex.fetchFundingRate(symbol);

        // El open interest es un endpoint aparte y no todos los exchanges lo tienen.
        let openInterest: number | null = null;
        if (ex.has?.fetchOpenInterest) {
          try {
            const oi = await ex.fetchOpenInterest(symbol);
            openInterest = oi?.openInterestAmount ?? oi?.openInterestValue ?? null;
          } catch {
            // No es fatal: se devuelve el funding igual, con openInterest en null.
          }
        }

        return ok({
          exchange,
          symbol,
          fundingRate: fr.fundingRate ?? null,
          fundingRatePct: fr.fundingRate != null ? fr.fundingRate * 100 : null,
          nextFundingTime: fr.fundingTimestamp ?? fr.nextFundingTimestamp ?? null,
          openInterest,
          markPrice: fr.markPrice ?? null,
          indexPrice: fr.indexPrice ?? null,
        });
      })
  );
}
