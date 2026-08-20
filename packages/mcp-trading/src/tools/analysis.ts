/**
 * Tools de análisis técnico y screening.
 *
 * Todas son de sólo lectura y derivan de datos públicos. `ta_indicators` es la
 * que más se usa: devuelve el último valor de cada indicador además de la serie
 * completa, para que el modelo pueda razonar sin tener que recorrer arrays.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getPublicExchange } from "../exchanges.ts";
import { type TradingContext, ToolError, ok, guard } from "../context.ts";
import {
  type Candle, closes, sma, ema, rsi, macd, bollinger, atr, vwap, last, levels,
} from "../indicators.ts";

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
const INDICATORS = ["rsi", "macd", "ema", "sma", "bollinger", "atr", "vwap"] as const;

function publicExchange(ctx: TradingContext, id: string) {
  const d = ctx.policy.checkRead(id);
  if (!d.allowed) throw new ToolError(d.reason!);
  return getPublicExchange(id);
}

export function registerAnalysisTools(server: McpServer, ctx: TradingContext): void {
  server.registerTool(
    "ta_indicators",
    {
      title: "Indicadores técnicos",
      description:
        "Calcula indicadores técnicos sobre las velas de un símbolo: RSI, MACD, EMA, SMA, " +
        "Bandas de Bollinger, ATR y VWAP. Usa suavizado de Wilder, así que los valores " +
        "coinciden con TradingView. Devuelve el último valor de cada uno y la serie completa. " +
        "Spanish: rsi, macd, medias móviles, bollinger, indicadores, análisis técnico",
      inputSchema: z.object({
        symbol: z.string().describe('Símbolo unificado, por ejemplo "BTC/USDT"'),
        timeframe: z.enum(TIMEFRAMES).default("1h"),
        indicators: z.array(z.enum(INDICATORS)).default(["rsi", "macd", "ema"])
          .describe("Indicadores a calcular"),
        limit: z.number().int().min(30).max(1000).default(200)
          .describe("Velas a descargar. Más velas = indicadores más estables al inicio."),
        emaPeriods: z.array(z.number().int().min(2).max(400)).default([20, 50, 200])
          .describe("Periodos para EMA y SMA"),
        rsiPeriod: z.number().int().min(2).max(100).default(14),
        exchange: z.string().default(ctx.defaultExchange),
        includeSeries: z.boolean().default(false)
          .describe("Incluir las series completas además del último valor. Genera respuestas grandes."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const { symbol, timeframe, indicators, limit, emaPeriods, rsiPeriod, exchange, includeSeries } = args;
        const ex = publicExchange(ctx, exchange);
        const candles = (await ex.fetchOHLCV(symbol, timeframe, undefined, limit)) as Candle[];

        if (candles.length < 30) {
          throw new ToolError(
            `Sólo se obtuvieron ${candles.length} velas de ${symbol} — insuficiente para indicadores fiables`
          );
        }

        const c = closes(candles);
        const latest: Record<string, unknown> = {};
        const series: Record<string, unknown> = {};

        for (const ind of indicators) {
          switch (ind) {
            case "rsi": {
              const s = rsi(c, rsiPeriod);
              latest.rsi = last(s);
              if (includeSeries) series.rsi = s;
              break;
            }
            case "macd": {
              const m = macd(c);
              latest.macd = { macd: last(m.macd), signal: last(m.signal), histogram: last(m.histogram) };
              if (includeSeries) series.macd = m;
              break;
            }
            case "ema": {
              const byPeriod: Record<string, number | null> = {};
              for (const p of emaPeriods) {
                const s = ema(c, p);
                byPeriod[`ema${p}`] = last(s);
                if (includeSeries) series[`ema${p}`] = s;
              }
              latest.ema = byPeriod;
              break;
            }
            case "sma": {
              const byPeriod: Record<string, number | null> = {};
              for (const p of emaPeriods) {
                const s = sma(c, p);
                byPeriod[`sma${p}`] = last(s);
                if (includeSeries) series[`sma${p}`] = s;
              }
              latest.sma = byPeriod;
              break;
            }
            case "bollinger": {
              const b = bollinger(c);
              latest.bollinger = { upper: last(b.upper), middle: last(b.middle), lower: last(b.lower) };
              if (includeSeries) series.bollinger = b;
              break;
            }
            case "atr": {
              const s = atr(candles);
              latest.atr = last(s);
              if (includeSeries) series.atr = s;
              break;
            }
            case "vwap": {
              const s = vwap(candles);
              latest.vwap = last(s);
              if (includeSeries) series.vwap = s;
              break;
            }
          }
        }

        const price = c[c.length - 1]!;
        return ok({
          exchange, symbol, timeframe,
          candles: candles.length,
          price,
          latest,
          ...(includeSeries ? { series } : {}),
        });
      })
  );

  server.registerTool(
    "ta_levels",
    {
      title: "Soportes y resistencias",
      description:
        "Detecta niveles de soporte y resistencia por pivotes fractales y los agrupa por " +
        "cercanía. Más toques = nivel más relevante. Devuelve también los niveles más " +
        "próximos al precio actual por arriba y por abajo. " +
        "Spanish: soportes, resistencias, niveles, zonas clave",
      inputSchema: z.object({
        symbol: z.string(),
        timeframe: z.enum(TIMEFRAMES).default("4h"),
        limit: z.number().int().min(50).max(1000).default(300),
        lookback: z.number().int().min(2).max(20).default(3)
          .describe("Velas a cada lado que debe superar un pivote"),
        exchange: z.string().default(ctx.defaultExchange),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ symbol, timeframe, limit, lookback, exchange }) =>
      guard(async () => {
        const ex = publicExchange(ctx, exchange);
        const candles = (await ex.fetchOHLCV(symbol, timeframe, undefined, limit)) as Candle[];
        if (candles.length < lookback * 2 + 5) {
          throw new ToolError(`Velas insuficientes (${candles.length}) para lookback=${lookback}`);
        }

        const price = candles[candles.length - 1]![4];
        const { support, resistance } = levels(candles, lookback);

        // El soporte relevante es el más cercano por debajo; la resistencia, por encima.
        const below = support.filter(l => l.price < price).sort((a, b) => b.price - a.price);
        const above = resistance.filter(l => l.price > price).sort((a, b) => a.price - b.price);

        return ok({
          exchange, symbol, timeframe, price,
          nearestSupport: below[0] ?? null,
          nearestResistance: above[0] ?? null,
          support: support.slice(0, 10),
          resistance: resistance.slice(0, 10),
        });
      })
  );

  server.registerTool(
    "scan_markets",
    {
      title: "Screener de mercados",
      description:
        "Filtra los mercados de un exchange por volumen y variación de 24h, y los ordena. " +
        "Sirve para encontrar qué se está moviendo antes de analizar un símbolo concreto. " +
        "Spanish: screener, qué se está moviendo, mayores subidas, top ganadores, más volumen",
      inputSchema: z.object({
        quote: z.string().default("USDT").describe("Moneda de cotización a filtrar"),
        minQuoteVolume: z.number().min(0).default(1_000_000)
          .describe("Volumen mínimo de 24h en la moneda de cotización"),
        sortBy: z.enum(["changePct", "quoteVolume", "changePctAbs"]).default("changePct"),
        direction: z.enum(["desc", "asc"]).default("desc"),
        limit: z.number().int().min(1).max(100).default(20),
        exchange: z.string().default(ctx.defaultExchange),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ quote, minQuoteVolume, sortBy, direction, limit, exchange }) =>
      guard(async () => {
        const ex = publicExchange(ctx, exchange);
        if (!ex.has?.fetchTickers) {
          throw new ToolError(`El exchange "${exchange}" no permite descargar todos los tickers de una vez`);
        }
        const tickers = await ex.fetchTickers();

        const rows = (Object.values(tickers) as any[])
          .filter(t => typeof t.symbol === "string" && t.symbol.endsWith(`/${quote}`))
          .filter(t => (t.quoteVolume ?? 0) >= minQuoteVolume)
          .map(t => ({
            symbol: t.symbol as string,
            last: t.last ?? null,
            changePct: t.percentage ?? null,
            quoteVolume: t.quoteVolume ?? 0,
          }))
          .filter(r => r.changePct !== null);

        const keyOf = (r: typeof rows[number]) =>
          sortBy === "quoteVolume" ? r.quoteVolume
          : sortBy === "changePctAbs" ? Math.abs(r.changePct!)
          : r.changePct!;

        rows.sort((a, b) => (direction === "desc" ? keyOf(b) - keyOf(a) : keyOf(a) - keyOf(b)));

        return ok({
          exchange, quote, sortBy, direction,
          scanned: rows.length,
          results: rows.slice(0, limit),
        });
      })
  );

  server.registerTool(
    "arbitrage_scan",
    {
      title: "Spread entre exchanges",
      description:
        "Compara el precio del mismo símbolo en varios exchanges y calcula el spread. " +
        "El spread bruto NO descuenta comisiones, retiros ni tiempo de transferencia: " +
        "es una señal para investigar, no una oportunidad confirmada. " +
        "Spanish: arbitraje, diferencia de precio entre exchanges, spread",
      inputSchema: z.object({
        symbol: z.string(),
        exchanges: z.array(z.string()).min(2).default(["binance", "kraken", "okx"])
          .describe("Exchanges a comparar"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ symbol, exchanges }) =>
      guard(async () => {
        // Se consultan en paralelo: la latencia importa, un precio viejo invalida la comparación.
        const results = await Promise.all(
          exchanges.map(async id => {
            try {
              const d = ctx.policy.checkRead(id);
              if (!d.allowed) return { exchange: id, error: d.reason! };
              const t = await getPublicExchange(id).fetchTicker(symbol);
              return { exchange: id, last: t.last ?? null, bid: t.bid ?? null, ask: t.ask ?? null };
            } catch (err) {
              // Un exchange caído o sin ese par no debe tumbar la comparación entera.
              return { exchange: id, error: err instanceof Error ? err.message : String(err) };
            }
          })
        );

        const valid = results.filter((r: any) => typeof r.last === "number") as any[];
        if (valid.length < 2) {
          throw new ToolError(
            `Sólo ${valid.length} exchange(s) devolvieron precio para ${symbol}; se necesitan al menos 2`
          );
        }

        const cheapest = valid.reduce((a, b) => (a.last < b.last ? a : b));
        const dearest = valid.reduce((a, b) => (a.last > b.last ? a : b));
        const spread = dearest.last - cheapest.last;

        return ok({
          symbol,
          quotes: results,
          buyAt: cheapest.exchange,
          sellAt: dearest.exchange,
          spread,
          spreadPct: (spread / cheapest.last) * 100,
          note: "Spread bruto: no descuenta comisiones de trading, retiro ni el tiempo de transferencia entre exchanges.",
        });
      })
  );
}
