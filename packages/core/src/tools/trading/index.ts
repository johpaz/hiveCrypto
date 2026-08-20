/**
 * Trading Tools — mercado, análisis técnico, paper trading, testnet y backtesting.
 *
 * Son envoltorios finos sobre los handlers de @johpaz/hivecrypto-mcp-trading:
 * la misma implementación que sirve el servidor MCP y las rutas del gateway.
 * Aquí sólo se traduce la forma `Tool` de hive y se aplican los valores por
 * defecto, porque el runtime de tools nativas no los rellena solo.
 *
 * Nota de nombres: esta carpeta es "trading", no "crypto", porque en el core ya
 * existen storage/crypto.ts y utils/crypto.ts y son *criptografía*.
 *
 * @category trading
 */

import type { Tool } from "../types.ts";
import { handlers } from "@johpaz/hivecrypto-mcp-trading";
import { ToolError } from "@johpaz/hivecrypto-mcp-trading";
import { getTradingContext } from "./context.ts";

/** Ejecuta un handler y normaliza el resultado a la forma { ok, ... } de hive. */
async function run<T>(fn: () => Promise<T>): Promise<object> {
  try {
    return { ok: true, ...(await fn() as object) };
  } catch (err) {
    if (err instanceof ToolError) {
      return { ok: false, error: err.message, ...(err.hint ? { hint: err.hint } : {}) };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const str = (v: unknown, def = "") => (typeof v === "string" && v ? v : def);
const num = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def);
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
const arr = <T>(v: unknown, def: T[]) => (Array.isArray(v) && v.length ? (v as T[]) : def);

const exchangeParam = {
  type: "string",
  description: "Id del exchange en CCXT (binance, bybit, okx, kraken...). Por defecto el configurado.",
} as const;

const symbolParam = {
  type: "string",
  description: 'Símbolo unificado de CCXT, por ejemplo "BTC/USDT"',
} as const;

export function createTools(): Tool[] {
  const ctx = () => getTradingContext();
  const ex = (p: Record<string, unknown>) => str(p.exchange, getTradingContext().defaultExchange);

  return [
    // ── MERCADO ──────────────────────────────────────────────────────────
    {
      name: "market_ticker",
      description:
        "Precio actual y estadísticas de 24h de un símbolo cripto: last, bid, ask, volumen y variación porcentual. " +
        "Spanish: precio de bitcoin, cotización, cuánto vale, a cómo está, precio actual",
      parameters: {
        type: "object",
        properties: { symbol: symbolParam, exchange: exchangeParam },
        required: ["symbol"],
      },
      execute: async (p) => run(() => handlers.marketTicker(ctx(), { symbol: str(p.symbol), exchange: ex(p) })),
    },
    {
      name: "market_ohlcv",
      description:
        "Serie de velas (candlesticks) de un símbolo: [timestamp, open, high, low, close, volume]. " +
        "Spanish: velas, gráfico de precios, histórico, candlestick",
      parameters: {
        type: "object",
        properties: {
          symbol: symbolParam,
          timeframe: { type: "string", description: "1m, 5m, 15m, 30m, 1h, 4h, 1d o 1w. Por defecto 1h.", enum: ["1m","5m","15m","30m","1h","4h","1d","1w"] },
          limit: { type: "number", description: "Número de velas (1-1000). Por defecto 100.", minimum: 1, maximum: 1000 },
          exchange: exchangeParam,
        },
        required: ["symbol"],
      },
      execute: async (p) => run(() => handlers.marketOhlcv(ctx(), {
        symbol: str(p.symbol), timeframe: str(p.timeframe, "1h"),
        limit: num(p.limit, 100), exchange: ex(p),
      })),
    },
    {
      name: "market_orderbook",
      description:
        "Profundidad L2 del libro de órdenes: bids y asks con precio y cantidad, más el spread. " +
        "Spanish: libro de órdenes, profundidad, order book, liquidez, spread",
      parameters: {
        type: "object",
        properties: {
          symbol: symbolParam,
          depth: { type: "number", description: "Niveles por lado (1-100). Por defecto 20.", minimum: 1, maximum: 100 },
          exchange: exchangeParam,
        },
        required: ["symbol"],
      },
      execute: async (p) => run(() => handlers.marketOrderbook(ctx(), {
        symbol: str(p.symbol), depth: num(p.depth, 20), exchange: ex(p),
      })),
    },
    {
      name: "market_trades",
      description:
        "Últimas operaciones ejecutadas en el mercado, con volumen comprador y vendedor agregado. " +
        "Spanish: trades recientes, operaciones, flujo de órdenes, presión compradora",
      parameters: {
        type: "object",
        properties: {
          symbol: symbolParam,
          limit: { type: "number", description: "Operaciones a traer (1-500). Por defecto 50.", minimum: 1, maximum: 500 },
          exchange: exchangeParam,
        },
        required: ["symbol"],
      },
      execute: async (p) => run(() => handlers.marketTrades(ctx(), {
        symbol: str(p.symbol), limit: num(p.limit, 50), exchange: ex(p),
      })),
    },
    {
      name: "market_symbols",
      description:
        "Lista o busca los mercados disponibles en un exchange. Úsala cuando no sepas el símbolo exacto. " +
        "Spanish: buscar par, qué símbolos hay, mercados disponibles, existe el par",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: 'Filtro por texto, por ejemplo "BTC" o "/USDT"' },
          type: { type: "string", description: "spot, swap, future o all. Por defecto spot.", enum: ["spot","swap","future","all"] },
          limit: { type: "number", description: "Máximo de resultados. Por defecto 50.", minimum: 1, maximum: 200 },
          exchange: exchangeParam,
        },
      },
      execute: async (p) => run(() => handlers.marketSymbols(ctx(), {
        query: typeof p.query === "string" ? p.query : undefined,
        type: str(p.type, "spot"), limit: num(p.limit, 50), exchange: ex(p),
      })),
    },
    {
      name: "market_funding",
      description:
        "Tasa de financiación y open interest de un contrato perpetuo. Funding positivo = los largos pagan a los cortos. " +
        "Spanish: funding rate, tasa de financiación, interés abierto, perpetuos",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: 'Símbolo del perpetuo, por ejemplo "BTC/USDT:USDT"' },
          exchange: exchangeParam,
        },
        required: ["symbol"],
      },
      execute: async (p) => run(() => handlers.marketFunding(ctx(), { symbol: str(p.symbol), exchange: ex(p) })),
    },

    // ── ANÁLISIS ─────────────────────────────────────────────────────────
    {
      name: "ta_indicators",
      description:
        "Indicadores técnicos sobre las velas de un símbolo: RSI, MACD, EMA, SMA, Bollinger, ATR y VWAP. " +
        "Usa suavizado de Wilder, así que los valores coinciden con TradingView. " +
        "Spanish: rsi, macd, medias móviles, bollinger, indicadores, análisis técnico, sobrecomprado",
      parameters: {
        type: "object",
        properties: {
          symbol: symbolParam,
          timeframe: { type: "string", description: "Por defecto 1h.", enum: ["1m","5m","15m","30m","1h","4h","1d","1w"] },
          indicators: {
            type: "array",
            description: 'Indicadores a calcular. Por defecto ["rsi","macd","ema"].',
            items: { type: "string", enum: ["rsi","macd","ema","sma","bollinger","atr","vwap"] },
          },
          limit: { type: "number", description: "Velas a descargar (30-1000). Por defecto 200.", minimum: 30, maximum: 1000 },
          emaPeriods: { type: "array", description: "Periodos de EMA/SMA. Por defecto [20,50,200].", items: { type: "number" } },
          rsiPeriod: { type: "number", description: "Periodo del RSI. Por defecto 14.", minimum: 2, maximum: 100 },
          includeSeries: { type: "boolean", description: "Incluir las series completas. Respuestas grandes. Por defecto false." },
          exchange: exchangeParam,
        },
        required: ["symbol"],
      },
      execute: async (p) => run(() => handlers.taIndicators(ctx(), {
        symbol: str(p.symbol), timeframe: str(p.timeframe, "1h"),
        indicators: arr<string>(p.indicators, ["rsi", "macd", "ema"]),
        limit: num(p.limit, 200), emaPeriods: arr<number>(p.emaPeriods, [20, 50, 200]),
        rsiPeriod: num(p.rsiPeriod, 14), exchange: ex(p),
        includeSeries: bool(p.includeSeries, false),
      })),
    },
    {
      name: "ta_levels",
      description:
        "Soportes y resistencias por pivotes fractales, agrupados por cercanía. Más toques = nivel más relevante. " +
        "Spanish: soportes, resistencias, niveles, zonas clave, dónde rebota",
      parameters: {
        type: "object",
        properties: {
          symbol: symbolParam,
          timeframe: { type: "string", description: "Por defecto 4h.", enum: ["1m","5m","15m","30m","1h","4h","1d","1w"] },
          limit: { type: "number", description: "Velas de historia. Por defecto 300.", minimum: 50, maximum: 1000 },
          lookback: { type: "number", description: "Velas a cada lado del pivote. Por defecto 3.", minimum: 2, maximum: 20 },
          exchange: exchangeParam,
        },
        required: ["symbol"],
      },
      execute: async (p) => run(() => handlers.taLevels(ctx(), {
        symbol: str(p.symbol), timeframe: str(p.timeframe, "4h"),
        limit: num(p.limit, 300), lookback: num(p.lookback, 3), exchange: ex(p),
      })),
    },
    {
      name: "scan_markets",
      description:
        "Screener: filtra los mercados por volumen y variación de 24h y los ordena. Para ver qué se está moviendo. " +
        "Spanish: screener, qué se está moviendo, mayores subidas, top ganadores, más volumen, qué comprar",
      parameters: {
        type: "object",
        properties: {
          quote: { type: "string", description: "Moneda de cotización. Por defecto USDT." },
          minQuoteVolume: { type: "number", description: "Volumen mínimo de 24h. Por defecto 1000000.", minimum: 0 },
          sortBy: { type: "string", description: "Por defecto changePct.", enum: ["changePct","quoteVolume","changePctAbs"] },
          direction: { type: "string", description: "Por defecto desc.", enum: ["desc","asc"] },
          limit: { type: "number", description: "Resultados. Por defecto 20.", minimum: 1, maximum: 100 },
          exchange: exchangeParam,
        },
      },
      execute: async (p) => run(() => handlers.scanMarkets(ctx(), {
        quote: str(p.quote, "USDT"), minQuoteVolume: num(p.minQuoteVolume, 1_000_000),
        sortBy: str(p.sortBy, "changePct"), direction: str(p.direction, "desc"),
        limit: num(p.limit, 20), exchange: ex(p),
      })),
    },
    {
      name: "arbitrage_scan",
      description:
        "Compara el precio del mismo símbolo entre varios exchanges y calcula el spread. El spread bruto no descuenta " +
        "comisiones ni retiros. Spanish: arbitraje, diferencia de precio entre exchanges, spread",
      parameters: {
        type: "object",
        properties: {
          symbol: symbolParam,
          exchanges: {
            type: "array",
            description: 'Exchanges a comparar. Por defecto ["binance","kraken","okx"].',
            items: { type: "string" },
          },
        },
        required: ["symbol"],
      },
      execute: async (p) => run(() => handlers.arbitrageScan(ctx(), {
        symbol: str(p.symbol), exchanges: arr<string>(p.exchanges, ["binance", "kraken", "okx"]),
      })),
    },

    // ── PAPER TRADING ────────────────────────────────────────────────────
    {
      name: "paper_account",
      description:
        "Crea o consulta la cuenta virtual de paper trading: saldo, equity, posiciones y rendimiento total. " +
        "Spanish: cuenta demo, portafolio simulado, saldo virtual, cuánto tengo, mi cuenta",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "create o get. Por defecto get.", enum: ["create","get"] },
          accountId: { type: "string", description: 'Id de la cuenta. Por defecto "default".' },
          initialBalance: { type: "number", description: "Saldo inicial al crear. Por defecto 10000.", minimum: 1 },
          quote: { type: "string", description: "Moneda de cotización. Por defecto USDT." },
          exchange: exchangeParam,
        },
      },
      execute: async (p) => run(() => handlers.paperAccount(ctx(), {
        action: str(p.action, "get"), accountId: str(p.accountId, "default"),
        initialBalance: num(p.initialBalance, 10_000), quote: str(p.quote, "USDT"), exchange: ex(p),
      })),
    },
    {
      name: "paper_order",
      description:
        "Ejecuta una orden de mercado SIMULADA contra el libro de órdenes real. No toca fondos reales ni llega al " +
        "exchange; el precio de fill incluye el slippage real del libro. " +
        "Spanish: comprar simulado, vender simulado, orden de prueba, paper trade, abrir posición",
      parameters: {
        type: "object",
        properties: {
          symbol: symbolParam,
          side: { type: "string", description: "buy o sell", enum: ["buy","sell"] },
          amount: { type: "number", description: "Cantidad en moneda base. Alternativa a notional.", minimum: 0 },
          notional: { type: "number", description: "Importe en moneda de cotización. Alternativa a amount.", minimum: 0 },
          accountId: { type: "string", description: 'Por defecto "default".' },
          exchange: exchangeParam,
        },
        required: ["symbol", "side"],
      },
      execute: async (p) => run(() => handlers.paperOrder(ctx(), {
        symbol: str(p.symbol), side: str(p.side) as "buy" | "sell",
        amount: typeof p.amount === "number" ? p.amount : undefined,
        notional: typeof p.notional === "number" ? p.notional : undefined,
        accountId: str(p.accountId, "default"), exchange: ex(p),
      })),
    },
    {
      name: "paper_positions",
      description:
        "Posiciones abiertas de la cuenta simulada con su PnL no realizado, valoradas a precio de mercado. " +
        "Spanish: mis posiciones, qué tengo abierto, ganancia no realizada, cómo van mis trades",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", description: 'Por defecto "default".' },
          exchange: exchangeParam,
        },
      },
      execute: async (p) => run(() => handlers.paperPositions(ctx(), {
        accountId: str(p.accountId, "default"), exchange: ex(p),
      })),
    },
    {
      name: "paper_close",
      description:
        "Cierra una posición simulada vendiendo toda la cantidad a mercado. Devuelve el PnL realizado. " +
        "Spanish: cerrar posición, vender todo, liquidar, salir de la posición",
      parameters: {
        type: "object",
        properties: {
          symbol: symbolParam,
          accountId: { type: "string", description: 'Por defecto "default".' },
          exchange: exchangeParam,
        },
        required: ["symbol"],
      },
      execute: async (p) => run(() => handlers.paperClose(ctx(), {
        symbol: str(p.symbol), accountId: str(p.accountId, "default"), exchange: ex(p),
      })),
    },
    {
      name: "paper_history",
      description:
        "Historial de operaciones simuladas con métricas: win rate, PnL total, profit factor y drawdown máximo. " +
        "Spanish: historial, resultados, estadísticas, cómo me fue, win rate, mis operaciones",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", description: 'Por defecto "default".' },
          limit: { type: "number", description: "Operaciones a traer. Por defecto 100.", minimum: 1, maximum: 1000 },
        },
      },
      execute: async (p) => run(() => handlers.paperHistory(ctx(), {
        accountId: str(p.accountId, "default"), limit: num(p.limit, 100),
      })),
    },

    // ── EXCHANGE (TESTNET) ───────────────────────────────────────────────
    {
      name: "exchange_balance",
      description:
        "Saldo de la cuenta en el TESTNET del exchange. Requiere TRADING_MODE=testnet y llaves de testnet. " +
        "Nunca consulta una cuenta de producción. Spanish: saldo en el exchange, balance de la cuenta",
      parameters: {
        type: "object",
        properties: {
          exchange: exchangeParam,
          hideZero: { type: "boolean", description: "Ocultar monedas con saldo cero. Por defecto true." },
        },
      },
      execute: async (p) => run(() => handlers.exchangeBalance(ctx(), {
        exchange: ex(p), hideZero: bool(p.hideZero, true),
      })),
    },
    {
      name: "exchange_order",
      description:
        "Coloca una orden en el TESTNET del exchange (fondos de prueba, nunca dinero real). Requiere " +
        "TRADING_MODE=testnet y pasa por whitelist y notional máximo. Spanish: orden en testnet, colocar orden",
      parameters: {
        type: "object",
        properties: {
          symbol: symbolParam,
          side: { type: "string", enum: ["buy","sell"] },
          type: { type: "string", description: "market o limit. Por defecto market.", enum: ["market","limit"] },
          amount: { type: "number", description: "Cantidad en moneda base.", minimum: 0 },
          price: { type: "number", description: "Precio límite. Obligatorio si type=limit.", minimum: 0 },
          exchange: exchangeParam,
        },
        required: ["symbol", "side", "amount"],
      },
      execute: async (p) => run(() => handlers.exchangeOrder(ctx(), {
        symbol: str(p.symbol), side: str(p.side) as "buy" | "sell",
        type: str(p.type, "market") as "market" | "limit",
        amount: num(p.amount, 0),
        price: typeof p.price === "number" ? p.price : undefined,
        exchange: ex(p),
      })),
    },
    {
      name: "exchange_orders",
      description:
        "Lista o cancela órdenes abiertas en el TESTNET del exchange. " +
        "Spanish: órdenes abiertas, cancelar orden, qué tengo pendiente",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "list o cancel. Por defecto list.", enum: ["list","cancel"] },
          symbol: { type: "string", description: "Filtra por símbolo. Obligatorio para cancelar." },
          orderId: { type: "string", description: "Id de la orden a cancelar." },
          exchange: exchangeParam,
        },
      },
      execute: async (p) => run(() => handlers.exchangeOrders(ctx(), {
        action: str(p.action, "list"),
        symbol: typeof p.symbol === "string" ? p.symbol : undefined,
        orderId: typeof p.orderId === "string" ? p.orderId : undefined,
        exchange: ex(p),
      })),
    },

    // ── BACKTESTING ──────────────────────────────────────────────────────
    {
      name: "backtest_run",
      description:
        'Prueba una estrategia sobre datos históricos: "ema_cross" (cruce de medias) o "rsi_threshold" ' +
        "(sobrecompra/sobreventa). Devuelve operaciones, rendimiento y comparación contra comprar y mantener. " +
        "Spanish: backtest, probar estrategia, simular histórico, qué habría pasado, validar idea",
      parameters: {
        type: "object",
        properties: {
          symbol: symbolParam,
          strategy: { type: "string", description: "Por defecto ema_cross.", enum: ["ema_cross","rsi_threshold"] },
          timeframe: { type: "string", description: "Por defecto 1h.", enum: ["5m","15m","30m","1h","4h","1d"] },
          limit: { type: "number", description: "Velas de historia (100-1000). Por defecto 500.", minimum: 100, maximum: 1000 },
          initialBalance: { type: "number", description: "Por defecto 10000.", minimum: 1 },
          feeRate: { type: "number", description: "Comisión por operación. Por defecto 0.001.", minimum: 0, maximum: 0.01 },
          fastPeriod: { type: "number", description: "ema_cross: media rápida. Por defecto 20.", minimum: 2, maximum: 200 },
          slowPeriod: { type: "number", description: "ema_cross: media lenta. Por defecto 50.", minimum: 3, maximum: 400 },
          rsiPeriod: { type: "number", description: "Por defecto 14.", minimum: 2, maximum: 50 },
          rsiBuyBelow: { type: "number", description: "Por defecto 30.", minimum: 1, maximum: 50 },
          rsiSellAbove: { type: "number", description: "Por defecto 70.", minimum: 50, maximum: 99 },
          useSma: { type: "boolean", description: "Usar SMA en vez de EMA. Por defecto false." },
          exchange: exchangeParam,
        },
        required: ["symbol"],
      },
      execute: async (p) => run(() => handlers.backtestRun(ctx(), {
        symbol: str(p.symbol),
        strategy: str(p.strategy, "ema_cross") as "ema_cross" | "rsi_threshold",
        timeframe: str(p.timeframe, "1h"), limit: num(p.limit, 500),
        initialBalance: num(p.initialBalance, 10_000), feeRate: num(p.feeRate, 0.001),
        fastPeriod: num(p.fastPeriod, 20), slowPeriod: num(p.slowPeriod, 50),
        rsiPeriod: num(p.rsiPeriod, 14), rsiBuyBelow: num(p.rsiBuyBelow, 30),
        rsiSellAbove: num(p.rsiSellAbove, 70), useSma: bool(p.useSma, false),
        exchange: ex(p),
      })),
    },
  ];
}
