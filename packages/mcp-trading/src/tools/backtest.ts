/**
 * Backtesting de estrategias declarativas.
 *
 * La estrategia se describe con reglas simples sobre indicadores (cruce de
 * medias, umbrales de RSI) en vez de con código arbitrario: el modelo puede
 * componerlas sin que el servidor tenga que evaluar código del LLM.
 *
 * Limitaciones que el resultado declara explícitamente: sin slippage, sin
 * apalancamiento, una posición a la vez y entrada/salida al cierre de la vela.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getPublicExchange } from "../exchanges.ts";
import { type TradingContext, ToolError, ok, guard } from "../context.ts";
import { type Candle, closes, ema, sma, rsi } from "../indicators.ts";

const TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1d"] as const;

export function registerBacktestTools(server: McpServer, ctx: TradingContext): void {
  server.registerTool(
    "backtest_run",
    {
      title: "Backtest de estrategia",
      description:
        "Prueba una estrategia sobre datos históricos. Estrategias disponibles: " +
        '"ema_cross" (cruce de medias exponenciales) y "rsi_threshold" (sobrecompra/sobreventa). ' +
        "Devuelve las operaciones, el rendimiento y una comparación contra comprar y mantener. " +
        "Sin slippage ni apalancamiento, una posición a la vez. " +
        "Spanish: backtest, probar estrategia, simular histórico, qué habría pasado",
      inputSchema: z.object({
        symbol: z.string(),
        strategy: z.enum(["ema_cross", "rsi_threshold"]).default("ema_cross"),
        timeframe: z.enum(TIMEFRAMES).default("1h"),
        limit: z.number().int().min(100).max(1000).default(500).describe("Velas de historia"),
        initialBalance: z.number().positive().default(10_000),
        feeRate: z.number().min(0).max(0.01).default(0.001).describe("Comisión por operación (0.001 = 0.1%)"),
        fastPeriod: z.number().int().min(2).max(200).default(20).describe("ema_cross: media rápida"),
        slowPeriod: z.number().int().min(3).max(400).default(50).describe("ema_cross: media lenta"),
        rsiPeriod: z.number().int().min(2).max(50).default(14),
        rsiBuyBelow: z.number().min(1).max(50).default(30).describe("rsi_threshold: compra por debajo de"),
        rsiSellAbove: z.number().min(50).max(99).default(70).describe("rsi_threshold: vende por encima de"),
        useSma: z.boolean().default(false).describe("ema_cross: usar SMA en vez de EMA"),
        exchange: z.string().default(ctx.defaultExchange),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const {
          symbol, strategy, timeframe, limit, initialBalance, feeRate,
          fastPeriod, slowPeriod, rsiPeriod, rsiBuyBelow, rsiSellAbove, useSma, exchange,
        } = args;

        const d = ctx.policy.checkRead(exchange);
        if (!d.allowed) throw new ToolError(d.reason!);

        if (strategy === "ema_cross" && fastPeriod >= slowPeriod) {
          throw new ToolError(`fastPeriod (${fastPeriod}) debe ser menor que slowPeriod (${slowPeriod})`);
        }

        const candles = (await getPublicExchange(exchange)
          .fetchOHLCV(symbol, timeframe, undefined, limit)) as Candle[];
        if (candles.length < 60) {
          throw new ToolError(`Sólo ${candles.length} velas disponibles — insuficiente para un backtest`);
        }

        const c = closes(candles);
        const ma = useSma ? sma : ema;
        const fast = strategy === "ema_cross" ? ma(c, fastPeriod) : [];
        const slow = strategy === "ema_cross" ? ma(c, slowPeriod) : [];
        const rsiSeries = strategy === "rsi_threshold" ? rsi(c, rsiPeriod) : [];

        let balance = initialBalance;
        let position: { amount: number; entry: number; entryTs: number } | null = null;
        const trades: any[] = [];

        for (let i = 1; i < candles.length; i++) {
          const price = c[i]!;
          const ts = candles[i]![0];
          let signal: "buy" | "sell" | null = null;

          if (strategy === "ema_cross") {
            const f = fast[i], s = slow[i], fp = fast[i - 1], sp = slow[i - 1];
            if (f !== null && s !== null && fp !== null && sp !== null) {
              // Cruce al alza = compra; cruce a la baja = venta.
              if (fp <= sp && f > s) signal = "buy";
              else if (fp >= sp && f < s) signal = "sell";
            }
          } else {
            const r = rsiSeries[i], rp = rsiSeries[i - 1];
            if (r !== null && rp !== null) {
              // Se opera el cruce del umbral, no el estar por debajo: si no,
              // dispararía una compra en cada vela mientras dure la sobreventa.
              if (rp >= rsiBuyBelow && r < rsiBuyBelow) signal = "buy";
              else if (rp <= rsiSellAbove && r > rsiSellAbove) signal = "sell";
            }
          }

          if (signal === "buy" && !position) {
            const amount = (balance * (1 - feeRate)) / price;
            balance = 0;
            position = { amount, entry: price, entryTs: ts };
          } else if (signal === "sell" && position) {
            const proceeds = position.amount * price * (1 - feeRate);
            const pnl = proceeds - position.amount * position.entry;
            balance = proceeds;
            trades.push({
              entryTs: position.entryTs, exitTs: ts,
              entry: position.entry, exit: price,
              amount: position.amount, pnl,
              pnlPct: ((price - position.entry) / position.entry) * 100,
            });
            position = null;
          }
        }

        // La posición abierta al final se valora a mercado, no se descarta.
        const lastPrice = c[c.length - 1]!;
        const finalEquity = balance + (position ? position.amount * lastPrice : 0);

        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl < 0);
        const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

        // Comparación contra comprar y mantener: sin esto, un resultado positivo
        // en un mercado alcista parece bueno cuando puede ser peor que no hacer nada.
        const firstPrice = c[0]!;
        const buyHoldEquity = (initialBalance / firstPrice) * lastPrice;

        return ok({
          exchange, symbol, timeframe, strategy,
          candles: candles.length,
          params: strategy === "ema_cross"
            ? { fastPeriod, slowPeriod, ma: useSma ? "sma" : "ema", feeRate }
            : { rsiPeriod, rsiBuyBelow, rsiSellAbove, feeRate },
          initialBalance,
          finalEquity,
          returnPct: ((finalEquity - initialBalance) / initialBalance) * 100,
          buyHoldEquity,
          buyHoldReturnPct: ((buyHoldEquity - initialBalance) / initialBalance) * 100,
          beatsBuyHold: finalEquity > buyHoldEquity,
          closedTrades: trades.length,
          openPosition: position ? { amount: position.amount, entry: position.entry } : null,
          wins: wins.length,
          losses: losses.length,
          winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
          profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
          trades: trades.slice(-50),
          caveats: [
            "Sin slippage: las entradas y salidas asumen ejecución al cierre de la vela.",
            "Una sola posición a la vez, sin apalancamiento ni cortos.",
            "Rendimiento pasado sobre una ventana concreta; no es predictivo.",
          ],
        });
      })
  );
}
