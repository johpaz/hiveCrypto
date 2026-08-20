/**
 * Registro de las tools MCP.
 *
 * Este archivo sólo declara esquemas y delega en handlers.ts. Toda la lógica de
 * trading vive allí, compartida con las tools nativas y las rutas del gateway.
 *
 * El orden de registro es el orden de tools/list, y la spec 2026-07-28
 * recomienda que sea determinista para no invalidar el cache de prompt del
 * cliente en cada arranque. No reordenar sin motivo.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { type TradingContext, ok, guard } from "../context.ts";
import * as h from "../handlers.ts";

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
const BT_TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1d"] as const;
const INDICATORS = ["rsi", "macd", "ema", "sma", "bollinger", "atr", "vwap"] as const;

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

export function registerAllTools(server: McpServer, ctx: TradingContext): void {
  const ex = () => z.string().default(ctx.defaultExchange)
    .describe("Id del exchange en CCXT (binance, bybit, okx, kraken, coinbase...)");
  const sym = z.string().describe('Símbolo unificado de CCXT, por ejemplo "BTC/USDT"');

  // ── mercado ──────────────────────────────────────────────────────────────

  server.registerTool("market_ticker", {
    title: "Ticker de mercado",
    description: "Precio actual y estadísticas de 24h de un símbolo. Devuelve last, bid, ask, volumen y variación. " +
      "Spanish: precio de, cotización, cuánto vale, a cómo está",
    inputSchema: z.object({ symbol: sym, exchange: ex() }),
    annotations: READ_ONLY,
  }, async (a) => guard(async () => ok(await h.marketTicker(ctx, a))));

  server.registerTool("market_ohlcv", {
    title: "Velas OHLCV",
    description: "Serie de velas [timestamp, open, high, low, close, volume]. Entrada de ta_indicators y backtest_run. " +
      "Spanish: velas, gráfico, histórico de precios, candlestick",
    inputSchema: z.object({
      symbol: sym,
      timeframe: z.enum(TIMEFRAMES).default("1h"),
      limit: z.number().int().min(1).max(1000).default(100),
      exchange: ex(),
    }),
    annotations: READ_ONLY,
  }, async (a) => guard(async () => ok(await h.marketOhlcv(ctx, a))));

  server.registerTool("market_orderbook", {
    title: "Libro de órdenes",
    description: "Profundidad L2 del libro: bids y asks con precio y cantidad. Es lo que usa paper_order para el slippage. " +
      "Spanish: libro de órdenes, profundidad, order book, liquidez",
    inputSchema: z.object({
      symbol: sym,
      depth: z.number().int().min(1).max(100).default(20),
      exchange: ex(),
    }),
    annotations: READ_ONLY,
  }, async (a) => guard(async () => ok(await h.marketOrderbook(ctx, a))));

  server.registerTool("market_trades", {
    title: "Operaciones recientes",
    description: "Últimas operaciones del mercado con precio, cantidad y lado. Muestra hacia dónde presiona el flujo. " +
      "Spanish: trades recientes, operaciones, flujo de órdenes",
    inputSchema: z.object({
      symbol: sym,
      limit: z.number().int().min(1).max(500).default(50),
      exchange: ex(),
    }),
    annotations: READ_ONLY,
  }, async (a) => guard(async () => ok(await h.marketTrades(ctx, a))));

  server.registerTool("market_symbols", {
    title: "Buscar símbolos",
    description: "Lista o busca los mercados de un exchange. Úsala cuando no sepas el símbolo exacto. " +
      "Spanish: buscar par, qué símbolos hay, mercados disponibles",
    inputSchema: z.object({
      query: z.string().optional().describe('Filtro por texto, por ejemplo "BTC"'),
      type: z.enum(["spot", "swap", "future", "all"]).default("spot"),
      limit: z.number().int().min(1).max(200).default(50),
      exchange: ex(),
    }),
    annotations: READ_ONLY,
  }, async (a) => guard(async () => ok(await h.marketSymbols(ctx, a))));

  server.registerTool("market_funding", {
    title: "Funding y open interest",
    description: "Tasa de financiación y open interest de un perpetuo. Funding positivo = los largos pagan a los cortos. " +
      "Spanish: funding rate, tasa de financiación, interés abierto, perpetuos",
    inputSchema: z.object({
      symbol: z.string().describe('Símbolo del perpetuo, por ejemplo "BTC/USDT:USDT"'),
      exchange: ex(),
    }),
    annotations: READ_ONLY,
  }, async (a) => guard(async () => ok(await h.marketFunding(ctx, a))));

  // ── análisis ─────────────────────────────────────────────────────────────

  server.registerTool("ta_indicators", {
    title: "Indicadores técnicos",
    description: "RSI, MACD, EMA, SMA, Bollinger, ATR y VWAP sobre las velas de un símbolo. Usa suavizado de Wilder, " +
      "así que coincide con TradingView. Devuelve el último valor y, opcionalmente, la serie completa. " +
      "Spanish: rsi, macd, medias móviles, bollinger, indicadores, análisis técnico",
    inputSchema: z.object({
      symbol: sym,
      timeframe: z.enum(TIMEFRAMES).default("1h"),
      indicators: z.array(z.enum(INDICATORS)).default(["rsi", "macd", "ema"]),
      limit: z.number().int().min(30).max(1000).default(200),
      emaPeriods: z.array(z.number().int().min(2).max(400)).default([20, 50, 200]),
      rsiPeriod: z.number().int().min(2).max(100).default(14),
      exchange: ex(),
      includeSeries: z.boolean().default(false)
        .describe("Incluir las series completas. Genera respuestas grandes."),
    }),
    annotations: READ_ONLY,
  }, async (a) => guard(async () => ok(await h.taIndicators(ctx, a as h.IndicatorParams))));

  server.registerTool("ta_levels", {
    title: "Soportes y resistencias",
    description: "Detecta niveles por pivotes fractales y los agrupa por cercanía. Más toques = nivel más relevante. " +
      "Spanish: soportes, resistencias, niveles, zonas clave",
    inputSchema: z.object({
      symbol: sym,
      timeframe: z.enum(TIMEFRAMES).default("4h"),
      limit: z.number().int().min(50).max(1000).default(300),
      lookback: z.number().int().min(2).max(20).default(3),
      exchange: ex(),
    }),
    annotations: READ_ONLY,
  }, async (a) => guard(async () => ok(await h.taLevels(ctx, a))));

  server.registerTool("scan_markets", {
    title: "Screener de mercados",
    description: "Filtra mercados por volumen y variación de 24h y los ordena. Para encontrar qué se está moviendo. " +
      "Spanish: screener, qué se está moviendo, mayores subidas, top ganadores, más volumen",
    inputSchema: z.object({
      quote: z.string().default("USDT"),
      minQuoteVolume: z.number().min(0).default(1_000_000),
      sortBy: z.enum(["changePct", "quoteVolume", "changePctAbs"]).default("changePct"),
      direction: z.enum(["desc", "asc"]).default("desc"),
      limit: z.number().int().min(1).max(100).default(20),
      exchange: ex(),
    }),
    annotations: READ_ONLY,
  }, async (a) => guard(async () => ok(await h.scanMarkets(ctx, a))));

  server.registerTool("arbitrage_scan", {
    title: "Spread entre exchanges",
    description: "Compara el precio del mismo símbolo en varios exchanges. El spread bruto NO descuenta comisiones " +
      "ni retiros: es una señal para investigar, no una oportunidad confirmada. " +
      "Spanish: arbitraje, diferencia de precio entre exchanges, spread",
    inputSchema: z.object({
      symbol: sym,
      exchanges: z.array(z.string()).min(2).default(["binance", "kraken", "okx"]),
    }),
    annotations: READ_ONLY,
  }, async (a) => guard(async () => ok(await h.arbitrageScan(ctx, a))));

  // ── paper trading ────────────────────────────────────────────────────────

  server.registerTool("paper_account", {
    title: "Cuenta de paper trading",
    description: "Crea o consulta una cuenta virtual. Devuelve saldo, equity y rendimiento total. " +
      "Spanish: cuenta demo, portafolio simulado, saldo virtual, cuánto tengo",
    inputSchema: z.object({
      action: z.enum(["create", "get"]).default("get"),
      accountId: z.string().default("default"),
      initialBalance: z.number().min(1).default(10_000),
      quote: z.string().default("USDT"),
      exchange: ex(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (a) => guard(async () => ok(await h.paperAccount(ctx, a))));

  server.registerTool("paper_order", {
    title: "Orden simulada",
    description: "Ejecuta una orden de mercado SIMULADA contra el libro real. No toca fondos reales ni llega al " +
      "exchange. El fill recorre los niveles del libro, así que incluye slippage real. " +
      "Spanish: comprar simulado, vender simulado, orden de prueba, paper trade",
    inputSchema: z.object({
      symbol: sym,
      side: z.enum(["buy", "sell"]),
      amount: z.number().positive().optional().describe("Cantidad en moneda base. Alternativa a notional."),
      notional: z.number().positive().optional().describe("Importe en moneda de cotización."),
      accountId: z.string().default("default"),
      exchange: ex(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (a) => guard(async () => ok(await h.paperOrder(ctx, a))));

  server.registerTool("paper_positions", {
    title: "Posiciones abiertas",
    description: "Posiciones abiertas con su PnL no realizado, valoradas a precio de mercado. " +
      "Spanish: mis posiciones, qué tengo abierto, ganancia no realizada",
    inputSchema: z.object({
      accountId: z.string().default("default"),
      exchange: ex(),
    }),
    annotations: { readOnlyHint: true },
  }, async (a) => guard(async () => ok(await h.paperPositions(ctx, a))));

  server.registerTool("paper_close", {
    title: "Cerrar posición simulada",
    description: "Cierra una posición vendiendo toda la cantidad a mercado contra el libro real. Devuelve el PnL realizado. " +
      "Spanish: cerrar posición, vender todo, liquidar",
    inputSchema: z.object({
      symbol: sym,
      accountId: z.string().default("default"),
      exchange: ex(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async (a) => guard(async () => ok(await h.paperClose(ctx, a))));

  server.registerTool("paper_history", {
    title: "Historial y métricas",
    description: "Historial de operaciones con métricas: win rate, PnL total, profit factor, drawdown máximo. " +
      "Spanish: historial, resultados, estadísticas, cómo me fue, win rate",
    inputSchema: z.object({
      accountId: z.string().default("default"),
      limit: z.number().int().min(1).max(1000).default(100),
    }),
    annotations: { readOnlyHint: true },
  }, async (a) => guard(async () => ok(await h.paperHistory(ctx, a))));

  // ── exchange (testnet) ───────────────────────────────────────────────────

  server.registerTool("exchange_balance", {
    title: "Saldo en testnet",
    description: "Saldo de la cuenta en el TESTNET del exchange. Requiere TRADING_MODE=testnet. " +
      "Nunca consulta una cuenta de producción. " +
      "Spanish: saldo real, balance de la cuenta, cuánto hay en el exchange",
    inputSchema: z.object({ exchange: ex(), hideZero: z.boolean().default(true) }),
    annotations: READ_ONLY,
  }, async (a) => guard(async () => ok(await h.exchangeBalance(ctx, a))));

  server.registerTool("exchange_order", {
    title: "Orden en testnet",
    description: "Coloca una orden en el TESTNET del exchange (fondos de prueba, nunca dinero real). " +
      "Requiere TRADING_MODE=testnet y pasa por whitelist y notional máximo. " +
      "Spanish: orden real de prueba, comprar en testnet, colocar orden",
    inputSchema: z.object({
      symbol: sym,
      side: z.enum(["buy", "sell"]),
      type: z.enum(["market", "limit"]).default("market"),
      amount: z.number().positive(),
      price: z.number().positive().optional().describe("Obligatorio si type=limit"),
      exchange: ex(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, async (a) => guard(async () => ok(await h.exchangeOrder(ctx, a))));

  server.registerTool("exchange_orders", {
    title: "Órdenes abiertas en testnet",
    description: "Lista o cancela órdenes abiertas en el TESTNET. " +
      "Spanish: órdenes abiertas, cancelar orden, qué tengo pendiente",
    inputSchema: z.object({
      action: z.enum(["list", "cancel"]).default("list"),
      symbol: z.string().optional(),
      orderId: z.string().optional(),
      exchange: ex(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, async (a) => guard(async () => ok(await h.exchangeOrders(ctx, a))));

  // ── backtesting ──────────────────────────────────────────────────────────

  server.registerTool("backtest_run", {
    title: "Backtest de estrategia",
    description: 'Prueba una estrategia sobre histórico: "ema_cross" (cruce de medias) o "rsi_threshold". ' +
      "Devuelve operaciones, rendimiento y comparación contra comprar y mantener. " +
      "Sin slippage ni apalancamiento, una posición a la vez. " +
      "Spanish: backtest, probar estrategia, simular histórico, qué habría pasado",
    inputSchema: z.object({
      symbol: sym,
      strategy: z.enum(["ema_cross", "rsi_threshold"]).default("ema_cross"),
      timeframe: z.enum(BT_TIMEFRAMES).default("1h"),
      limit: z.number().int().min(100).max(1000).default(500),
      initialBalance: z.number().positive().default(10_000),
      feeRate: z.number().min(0).max(0.01).default(0.001),
      fastPeriod: z.number().int().min(2).max(200).default(20),
      slowPeriod: z.number().int().min(3).max(400).default(50),
      rsiPeriod: z.number().int().min(2).max(50).default(14),
      rsiBuyBelow: z.number().min(1).max(50).default(30),
      rsiSellAbove: z.number().min(50).max(99).default(70),
      useSma: z.boolean().default(false),
      exchange: ex(),
    }),
    annotations: READ_ONLY,
  }, async (a) => guard(async () => ok(await h.backtestRun(ctx, a as h.BacktestParams))));
}
