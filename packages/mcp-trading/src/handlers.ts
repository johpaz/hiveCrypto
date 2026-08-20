/**
 * Handlers — la lógica de trading, sin protocolo.
 *
 * Estas funciones son la ÚNICA implementación. Tres superficies las envuelven:
 *
 *   1. El servidor MCP (tools/*.ts)      → clientes externos: Claude Code, Cursor
 *   2. Las tools nativas de hiveCrypto   → los agentes, en proceso
 *   3. Las rutas del gateway             → la UI y la app de escritorio
 *
 * El motivo de que exista este archivo: si cada superficie tuviera su propia
 * copia, el cálculo de un fill o de un guardrail podría divergir entre lo que
 * ve el agente y lo que ve la UI. En un producto de trading eso no es aceptable.
 *
 * Convención: reciben (ctx, params) y devuelven datos planos. Lanzan ToolError
 * para errores de negocio; quien envuelve decide cómo presentarlos.
 */

import { getPublicExchange, getPrivateExchange, credentialsFromEnv, assertSandbox } from "./exchanges.ts";
import { type TradingContext, ToolError } from "./context.ts";
import {
  type Candle, closes, sma, ema, rsi, macd, bollinger, atr, vwap, last, levels,
} from "./indicators.ts";
import { executeMarketOrder, performance, type PaperAccount } from "./paper-engine.ts";

// ── helpers ────────────────────────────────────────────────────────────────

function pub(ctx: TradingContext, id: string) {
  const d = ctx.policy.checkRead(id);
  if (!d.allowed) throw new ToolError(d.reason!);
  return getPublicExchange(id);
}

function priv(ctx: TradingContext, id: string) {
  if (ctx.policy.config.mode !== "testnet") {
    throw new ToolError(
      `TRADING_MODE="${ctx.policy.config.mode}": las operaciones contra el exchange requieren modo "testnet"`,
      "Usa las funciones paper_* para simular"
    );
  }
  const creds = credentialsFromEnv(id);
  if (!creds) {
    throw new ToolError(
      `Faltan credenciales de testnet para "${id}"`,
      `Define ${id.toUpperCase()}_API_KEY y ${id.toUpperCase()}_SECRET con llaves del TESTNET`
    );
  }
  const ex = getPrivateExchange(id, creds);
  assertSandbox(ex, id);
  return ex;
}

async function loadAccount(ctx: TradingContext, id: string): Promise<PaperAccount> {
  const acc = await ctx.store.getAccount(id);
  if (!acc) throw new ToolError(`No existe la cuenta paper "${id}"`, 'Créala con paper_account action:"create"');
  return acc;
}

/** Precio de mercado, o null si el exchange no responde. Nunca lanza. */
async function safePrice(ex: any, symbol: string): Promise<number | null> {
  try { return (await ex.fetchTicker(symbol)).last ?? null; } catch { return null; }
}

// ── mercado ────────────────────────────────────────────────────────────────

export async function marketTicker(ctx: TradingContext, p: { symbol: string; exchange: string }) {
  const t = await pub(ctx, p.exchange).fetchTicker(p.symbol);
  return {
    exchange: p.exchange, symbol: p.symbol,
    last: t.last ?? null, bid: t.bid ?? null, ask: t.ask ?? null,
    high24h: t.high ?? null, low24h: t.low ?? null,
    baseVolume: t.baseVolume ?? null, quoteVolume: t.quoteVolume ?? null,
    changePct24h: t.percentage ?? null, timestamp: t.timestamp ?? null,
  };
}

export async function marketOhlcv(
  ctx: TradingContext,
  p: { symbol: string; timeframe: string; limit: number; exchange: string }
) {
  const ex = pub(ctx, p.exchange);
  if (!ex.has?.fetchOHLCV) throw new ToolError(`El exchange "${p.exchange}" no expone OHLCV`);
  const candles = await ex.fetchOHLCV(p.symbol, p.timeframe, undefined, p.limit);
  return { exchange: p.exchange, symbol: p.symbol, timeframe: p.timeframe, count: candles.length, candles };
}

export async function marketOrderbook(
  ctx: TradingContext,
  p: { symbol: string; depth: number; exchange: string }
) {
  const book = await pub(ctx, p.exchange).fetchOrderBook(p.symbol, p.depth);
  const bestBid = book.bids?.[0]?.[0] ?? null;
  const bestAsk = book.asks?.[0]?.[0] ?? null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  return {
    exchange: p.exchange, symbol: p.symbol,
    bids: book.bids ?? [], asks: book.asks ?? [],
    spread, spreadPct: spread !== null && bestBid ? (spread / bestBid) * 100 : null,
    timestamp: book.timestamp ?? null,
  };
}

export async function marketTrades(
  ctx: TradingContext,
  p: { symbol: string; limit: number; exchange: string }
) {
  const raw = await pub(ctx, p.exchange).fetchTrades(p.symbol, undefined, p.limit);
  const trades = raw.map((t: any) => ({
    ts: t.timestamp ?? null, price: t.price, amount: t.amount, side: t.side ?? null,
  }));
  return {
    exchange: p.exchange, symbol: p.symbol, count: trades.length,
    buyVolume: trades.filter(t => t.side === "buy").reduce((s, t) => s + t.amount, 0),
    sellVolume: trades.filter(t => t.side === "sell").reduce((s, t) => s + t.amount, 0),
    trades,
  };
}

export async function marketSymbols(
  ctx: TradingContext,
  p: { query?: string; type: string; limit: number; exchange: string }
) {
  const markets = await pub(ctx, p.exchange).loadMarkets();
  let list = Object.values(markets) as any[];
  if (p.type !== "all") list = list.filter(m => m.type === p.type);
  if (p.query) {
    const q = p.query.toUpperCase();
    list = list.filter(m => m.symbol?.toUpperCase().includes(q));
  }
  return {
    exchange: p.exchange, total: list.length, count: Math.min(list.length, p.limit),
    symbols: list.slice(0, p.limit).map(m => ({
      symbol: m.symbol, base: m.base, quote: m.quote,
      type: m.type ?? null, active: m.active ?? null,
    })),
  };
}

export async function marketFunding(ctx: TradingContext, p: { symbol: string; exchange: string }) {
  const ex = pub(ctx, p.exchange);
  if (!ex.has?.fetchFundingRate) {
    throw new ToolError(
      `El exchange "${p.exchange}" no expone funding rate`,
      "El funding sólo existe en perpetuos; prueba con un símbolo tipo BTC/USDT:USDT"
    );
  }
  const fr = await ex.fetchFundingRate(p.symbol);
  let openInterest: number | null = null;
  if (ex.has?.fetchOpenInterest) {
    try {
      const oi = await ex.fetchOpenInterest(p.symbol);
      openInterest = oi?.openInterestAmount ?? oi?.openInterestValue ?? null;
    } catch { /* no fatal: se devuelve el funding igual */ }
  }
  return {
    exchange: p.exchange, symbol: p.symbol,
    fundingRate: fr.fundingRate ?? null,
    fundingRatePct: fr.fundingRate != null ? fr.fundingRate * 100 : null,
    nextFundingTime: fr.fundingTimestamp ?? fr.nextFundingTimestamp ?? null,
    openInterest, markPrice: fr.markPrice ?? null, indexPrice: fr.indexPrice ?? null,
  };
}

// ── análisis ───────────────────────────────────────────────────────────────

export interface IndicatorParams {
  symbol: string; timeframe: string; indicators: string[]; limit: number;
  emaPeriods: number[]; rsiPeriod: number; exchange: string; includeSeries: boolean;
}

export async function taIndicators(ctx: TradingContext, p: IndicatorParams) {
  const candles = (await pub(ctx, p.exchange)
    .fetchOHLCV(p.symbol, p.timeframe, undefined, p.limit)) as Candle[];
  if (candles.length < 30) {
    throw new ToolError(`Sólo ${candles.length} velas de ${p.symbol} — insuficiente para indicadores fiables`);
  }

  const c = closes(candles);
  const latest: Record<string, unknown> = {};
  const series: Record<string, unknown> = {};

  for (const ind of p.indicators) {
    if (ind === "rsi") {
      const s = rsi(c, p.rsiPeriod);
      latest.rsi = last(s);
      if (p.includeSeries) series.rsi = s;
    } else if (ind === "macd") {
      const m = macd(c);
      latest.macd = { macd: last(m.macd), signal: last(m.signal), histogram: last(m.histogram) };
      if (p.includeSeries) series.macd = m;
    } else if (ind === "ema" || ind === "sma") {
      const fn = ind === "ema" ? ema : sma;
      const byPeriod: Record<string, number | null> = {};
      for (const period of p.emaPeriods) {
        const s = fn(c, period);
        byPeriod[`${ind}${period}`] = last(s);
        if (p.includeSeries) series[`${ind}${period}`] = s;
      }
      latest[ind] = byPeriod;
    } else if (ind === "bollinger") {
      const b = bollinger(c);
      latest.bollinger = { upper: last(b.upper), middle: last(b.middle), lower: last(b.lower) };
      if (p.includeSeries) series.bollinger = b;
    } else if (ind === "atr") {
      const s = atr(candles);
      latest.atr = last(s);
      if (p.includeSeries) series.atr = s;
    } else if (ind === "vwap") {
      const s = vwap(candles);
      latest.vwap = last(s);
      if (p.includeSeries) series.vwap = s;
    }
  }

  return {
    exchange: p.exchange, symbol: p.symbol, timeframe: p.timeframe,
    candles: candles.length, price: c[c.length - 1]!,
    latest, ...(p.includeSeries ? { series } : {}),
  };
}

export async function taLevels(
  ctx: TradingContext,
  p: { symbol: string; timeframe: string; limit: number; lookback: number; exchange: string }
) {
  const candles = (await pub(ctx, p.exchange)
    .fetchOHLCV(p.symbol, p.timeframe, undefined, p.limit)) as Candle[];
  if (candles.length < p.lookback * 2 + 5) {
    throw new ToolError(`Velas insuficientes (${candles.length}) para lookback=${p.lookback}`);
  }
  const price = candles[candles.length - 1]![4];
  const { support, resistance } = levels(candles, p.lookback);
  const below = support.filter(l => l.price < price).sort((a, b) => b.price - a.price);
  const above = resistance.filter(l => l.price > price).sort((a, b) => a.price - b.price);
  return {
    exchange: p.exchange, symbol: p.symbol, timeframe: p.timeframe, price,
    nearestSupport: below[0] ?? null, nearestResistance: above[0] ?? null,
    support: support.slice(0, 10), resistance: resistance.slice(0, 10),
  };
}

export async function scanMarkets(
  ctx: TradingContext,
  p: { quote: string; minQuoteVolume: number; sortBy: string; direction: string; limit: number; exchange: string }
) {
  const ex = pub(ctx, p.exchange);
  if (!ex.has?.fetchTickers) {
    throw new ToolError(`El exchange "${p.exchange}" no permite descargar todos los tickers de una vez`);
  }
  const tickers = await ex.fetchTickers();
  const rows = (Object.values(tickers) as any[])
    .filter(t => typeof t.symbol === "string" && t.symbol.endsWith(`/${p.quote}`))
    .filter(t => (t.quoteVolume ?? 0) >= p.minQuoteVolume)
    .map(t => ({
      symbol: t.symbol as string, last: t.last ?? null,
      changePct: t.percentage ?? null, quoteVolume: t.quoteVolume ?? 0,
    }))
    .filter(r => r.changePct !== null);

  const keyOf = (r: typeof rows[number]) =>
    p.sortBy === "quoteVolume" ? r.quoteVolume
    : p.sortBy === "changePctAbs" ? Math.abs(r.changePct!)
    : r.changePct!;
  rows.sort((a, b) => (p.direction === "desc" ? keyOf(b) - keyOf(a) : keyOf(a) - keyOf(b)));

  return {
    exchange: p.exchange, quote: p.quote, sortBy: p.sortBy, direction: p.direction,
    scanned: rows.length, results: rows.slice(0, p.limit),
  };
}

export async function arbitrageScan(ctx: TradingContext, p: { symbol: string; exchanges: string[] }) {
  const quotes = await Promise.all(
    p.exchanges.map(async id => {
      try {
        const d = ctx.policy.checkRead(id);
        if (!d.allowed) return { exchange: id, error: d.reason! };
        const t = await getPublicExchange(id).fetchTicker(p.symbol);
        return { exchange: id, last: t.last ?? null, bid: t.bid ?? null, ask: t.ask ?? null };
      } catch (err) {
        // Un exchange caído no debe tumbar la comparación entera.
        return { exchange: id, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  const valid = quotes.filter((r: any) => typeof r.last === "number") as any[];
  if (valid.length < 2) {
    throw new ToolError(`Sólo ${valid.length} exchange(s) dieron precio para ${p.symbol}; hacen falta 2`);
  }
  const cheapest = valid.reduce((a, b) => (a.last < b.last ? a : b));
  const dearest = valid.reduce((a, b) => (a.last > b.last ? a : b));
  const spread = dearest.last - cheapest.last;

  return {
    symbol: p.symbol, quotes,
    buyAt: cheapest.exchange, sellAt: dearest.exchange,
    spread, spreadPct: (spread / cheapest.last) * 100,
    note: "Spread bruto: no descuenta comisiones de trading, retiro ni el tiempo de transferencia.",
  };
}

// ── paper trading ──────────────────────────────────────────────────────────

export async function paperAccount(
  ctx: TradingContext,
  p: { action: string; accountId: string; initialBalance: number; quote: string; exchange: string }
) {
  let acc = await ctx.store.getAccount(p.accountId);

  if (p.action === "create") {
    if (acc) {
      throw new ToolError(
        `La cuenta "${p.accountId}" ya existe (saldo ${acc.balance.toFixed(2)} ${acc.quote})`,
        'Usa action:"get" o elige otro accountId'
      );
    }
    acc = {
      id: p.accountId, quote: p.quote, balance: p.initialBalance,
      initialBalance: p.initialBalance, createdAt: new Date().toISOString(),
    };
    await ctx.store.putAccount(acc);
  }
  if (!acc) throw new ToolError(`No existe la cuenta paper "${p.accountId}"`, 'Créala con action:"create"');

  const ex = getPublicExchange(p.exchange);
  const positions = await ctx.store.listPositions(p.accountId);
  let positionsValue = 0;
  const valued = [];
  for (const pos of positions) {
    const price = await safePrice(ex, pos.symbol);
    const mark = price ?? pos.entryPrice;
    const value = mark * pos.amount;
    positionsValue += value;
    valued.push({
      symbol: pos.symbol, amount: pos.amount, entryPrice: pos.entryPrice,
      markPrice: mark, priceStale: price === null, value,
      unrealizedPnl: (mark - pos.entryPrice) * pos.amount,
      unrealizedPnlPct: ((mark - pos.entryPrice) / pos.entryPrice) * 100,
      openedAt: pos.openedAt,
    });
  }

  const equity = acc.balance + positionsValue;
  return {
    account: acc, equity, positionsValue,
    totalReturn: equity - acc.initialBalance,
    totalReturnPct: ((equity - acc.initialBalance) / acc.initialBalance) * 100,
    positions: valued,
  };
}

export async function paperOrder(
  ctx: TradingContext,
  p: { symbol: string; side: "buy" | "sell"; amount?: number; notional?: number; accountId: string; exchange: string }
) {
  if (!p.amount && !p.notional) {
    throw new ToolError("Falta amount o notional", "Indica uno de los dos para dimensionar la orden");
  }
  const acc = await loadAccount(ctx, p.accountId);
  const book = await getPublicExchange(p.exchange).fetchOrderBook(p.symbol, 50);

  const reference = p.side === "buy" ? book.asks?.[0]?.[0] : book.bids?.[0]?.[0];
  if (!reference) throw new ToolError(`El libro de ${p.symbol} en ${p.exchange} vino vacío`);

  const qty = p.amount ?? p.notional! / reference;
  const estNotional = qty * reference;

  const decision = ctx.policy.checkPaperOrder({ exchange: p.exchange, symbol: p.symbol, notional: estNotional });
  ctx.policy.record({
    action: "paper_order", exchange: p.exchange, symbol: p.symbol, side: p.side,
    amount: qty, price: reference, notional: estNotional,
    allowed: decision.allowed, reason: decision.reason,
  });
  if (!decision.allowed) throw new ToolError(`Orden rechazada por política: ${decision.reason}`);

  const position = await ctx.store.getPosition(p.accountId, p.symbol);
  const r = executeMarketOrder(
    { account: acc, symbol: p.symbol, side: p.side, amount: qty, book, feeRate: ctx.feeRate },
    position
  );

  await ctx.store.putAccount(r.account);
  if (r.position) await ctx.store.putPosition(r.position);
  else await ctx.store.deletePosition(p.accountId, p.symbol);
  await ctx.store.appendTrade(r.trade);

  return {
    simulated: true, trade: r.trade, balance: r.account.balance, position: r.position,
    requestedAmount: qty, filledAmount: r.trade.amount,
    partialFill: r.trade.amount < qty - 1e-12,
  };
}

export async function paperPositions(ctx: TradingContext, p: { accountId: string; exchange: string }) {
  await loadAccount(ctx, p.accountId);
  const positions = await ctx.store.listPositions(p.accountId);
  const ex = getPublicExchange(p.exchange);

  const rows = [];
  let totalUnrealized = 0;
  for (const pos of positions) {
    const price = await safePrice(ex, pos.symbol);
    const mark = price ?? pos.entryPrice;
    const pnl = (mark - pos.entryPrice) * pos.amount;
    totalUnrealized += pnl;
    rows.push({
      symbol: pos.symbol, amount: pos.amount, entryPrice: pos.entryPrice,
      markPrice: mark, priceStale: price === null, value: mark * pos.amount,
      unrealizedPnl: pnl, unrealizedPnlPct: ((mark - pos.entryPrice) / pos.entryPrice) * 100,
      openedAt: pos.openedAt,
    });
  }
  return { accountId: p.accountId, count: rows.length, totalUnrealizedPnl: totalUnrealized, positions: rows };
}

export async function paperClose(
  ctx: TradingContext,
  p: { symbol: string; accountId: string; exchange: string }
) {
  const acc = await loadAccount(ctx, p.accountId);
  const position = await ctx.store.getPosition(p.accountId, p.symbol);
  if (!position || position.amount <= 0) {
    throw new ToolError(`No hay posición abierta en ${p.symbol} en la cuenta "${p.accountId}"`);
  }

  const book = await getPublicExchange(p.exchange).fetchOrderBook(p.symbol, 50);
  const r = executeMarketOrder(
    { account: acc, symbol: p.symbol, side: "sell", amount: position.amount, book, feeRate: ctx.feeRate },
    position
  );

  ctx.policy.record({
    action: "paper_close", exchange: p.exchange, symbol: p.symbol, side: "sell",
    amount: r.trade.amount, price: r.trade.price, notional: r.trade.notional, allowed: true,
  });

  await ctx.store.putAccount(r.account);
  if (r.position) await ctx.store.putPosition(r.position);
  else await ctx.store.deletePosition(p.accountId, p.symbol);
  await ctx.store.appendTrade(r.trade);

  return {
    simulated: true, closed: !r.position, trade: r.trade,
    realizedPnl: r.trade.realizedPnl ?? 0, balance: r.account.balance, remaining: r.position,
  };
}

export async function paperHistory(ctx: TradingContext, p: { accountId: string; limit: number }) {
  const acc = await loadAccount(ctx, p.accountId);
  const trades = await ctx.store.listTrades(p.accountId, p.limit);
  return {
    accountId: p.accountId, balance: acc.balance, initialBalance: acc.initialBalance,
    metrics: performance(trades), trades,
  };
}

// ── exchange (testnet) ─────────────────────────────────────────────────────

export async function exchangeBalance(ctx: TradingContext, p: { exchange: string; hideZero: boolean }) {
  const ex = priv(ctx, p.exchange);
  const bal = await ex.fetchBalance();
  const rows = Object.entries(bal.total ?? {})
    .map(([currency, total]) => ({
      currency, total: Number(total) || 0,
      free: Number(bal.free?.[currency]) || 0,
      used: Number(bal.used?.[currency]) || 0,
    }))
    .filter(r => (p.hideZero ? r.total > 0 : true));
  return { exchange: p.exchange, sandbox: true, count: rows.length, balances: rows };
}

export async function exchangeOrder(
  ctx: TradingContext,
  p: { symbol: string; side: "buy" | "sell"; type: "market" | "limit"; amount: number; price?: number; exchange: string }
) {
  if (p.type === "limit" && !p.price) throw new ToolError("Una orden limit necesita price");

  const ex = priv(ctx, p.exchange);
  // Segunda verificación justo antes de enviar.
  assertSandbox(ex, p.exchange);

  let reference = p.price;
  if (!reference) reference = (await ex.fetchTicker(p.symbol)).last ?? undefined;
  if (!reference) throw new ToolError(`No se pudo estimar el precio de ${p.symbol} para validar la orden`);

  const notional = p.amount * reference;
  const decision = ctx.policy.checkExchangeOrder({ exchange: p.exchange, symbol: p.symbol, notional });
  ctx.policy.record({
    action: "exchange_order", exchange: p.exchange, symbol: p.symbol, side: p.side,
    amount: p.amount, price: reference, notional,
    allowed: decision.allowed, reason: decision.reason,
  });
  if (!decision.allowed) throw new ToolError(`Orden rechazada por política: ${decision.reason}`);

  const o = await ex.createOrder(p.symbol, p.type, p.side, p.amount, p.price);
  return {
    sandbox: true, exchange: p.exchange,
    order: {
      id: o.id, symbol: o.symbol, side: o.side, type: o.type, amount: o.amount,
      price: o.price ?? null, status: o.status ?? null, filled: o.filled ?? null,
      timestamp: o.timestamp ?? null,
    },
  };
}

export async function exchangeOrders(
  ctx: TradingContext,
  p: { action: string; symbol?: string; orderId?: string; exchange: string }
) {
  const ex = priv(ctx, p.exchange);
  if (p.action === "cancel") {
    if (!p.orderId || !p.symbol) throw new ToolError("Para cancelar hacen falta orderId y symbol");
    const res = await ex.cancelOrder(p.orderId, p.symbol);
    ctx.policy.record({ action: "exchange_cancel", exchange: p.exchange, symbol: p.symbol, allowed: true });
    return { sandbox: true, cancelled: true, orderId: p.orderId, symbol: p.symbol, result: res?.status ?? "ok" };
  }
  const orders = await ex.fetchOpenOrders(p.symbol);
  return {
    sandbox: true, exchange: p.exchange, count: orders.length,
    orders: orders.map((o: any) => ({
      id: o.id, symbol: o.symbol, side: o.side, type: o.type, amount: o.amount,
      price: o.price ?? null, filled: o.filled ?? null, status: o.status ?? null,
      timestamp: o.timestamp ?? null,
    })),
  };
}

// ── backtesting ────────────────────────────────────────────────────────────

export interface BacktestParams {
  symbol: string; strategy: "ema_cross" | "rsi_threshold"; timeframe: string; limit: number;
  initialBalance: number; feeRate: number; fastPeriod: number; slowPeriod: number;
  rsiPeriod: number; rsiBuyBelow: number; rsiSellAbove: number; useSma: boolean; exchange: string;
}

export async function backtestRun(ctx: TradingContext, p: BacktestParams) {
  if (p.strategy === "ema_cross" && p.fastPeriod >= p.slowPeriod) {
    throw new ToolError(`fastPeriod (${p.fastPeriod}) debe ser menor que slowPeriod (${p.slowPeriod})`);
  }

  const candles = (await pub(ctx, p.exchange)
    .fetchOHLCV(p.symbol, p.timeframe, undefined, p.limit)) as Candle[];
  if (candles.length < 60) {
    throw new ToolError(`Sólo ${candles.length} velas disponibles — insuficiente para un backtest`);
  }

  const c = closes(candles);
  const ma = p.useSma ? sma : ema;
  const fast = p.strategy === "ema_cross" ? ma(c, p.fastPeriod) : [];
  const slow = p.strategy === "ema_cross" ? ma(c, p.slowPeriod) : [];
  const rsiSeries = p.strategy === "rsi_threshold" ? rsi(c, p.rsiPeriod) : [];

  let balance = p.initialBalance;
  let position: { amount: number; entry: number; entryTs: number } | null = null;
  const trades: any[] = [];
  const equityCurve: { ts: number; equity: number }[] = [];

  for (let i = 1; i < candles.length; i++) {
    const price = c[i]!;
    const ts = candles[i]![0];
    let signal: "buy" | "sell" | null = null;

    if (p.strategy === "ema_cross") {
      const f = fast[i], s = slow[i], fp = fast[i - 1], sp = slow[i - 1];
      if (f !== null && s !== null && fp !== null && sp !== null) {
        if (fp <= sp && f > s) signal = "buy";
        else if (fp >= sp && f < s) signal = "sell";
      }
    } else {
      const r = rsiSeries[i], rp = rsiSeries[i - 1];
      // Se opera el CRUCE del umbral: si no, dispararía en cada vela de sobreventa.
      if (r !== null && rp !== null) {
        if (rp >= p.rsiBuyBelow && r < p.rsiBuyBelow) signal = "buy";
        else if (rp <= p.rsiSellAbove && r > p.rsiSellAbove) signal = "sell";
      }
    }

    if (signal === "buy" && !position) {
      const amount = (balance * (1 - p.feeRate)) / price;
      balance = 0;
      position = { amount, entry: price, entryTs: ts };
    } else if (signal === "sell" && position) {
      const proceeds = position.amount * price * (1 - p.feeRate);
      trades.push({
        entryTs: position.entryTs, exitTs: ts, entry: position.entry, exit: price,
        amount: position.amount, pnl: proceeds - position.amount * position.entry,
        pnlPct: ((price - position.entry) / position.entry) * 100,
      });
      balance = proceeds;
      position = null;
    }

    equityCurve.push({ ts, equity: balance + (position ? position.amount * price : 0) });
  }

  const lastPrice = c[c.length - 1]!;
  const finalEquity = balance + (position ? position.amount * lastPrice : 0);
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const buyHoldEquity = (p.initialBalance / c[0]!) * lastPrice;

  return {
    exchange: p.exchange, symbol: p.symbol, timeframe: p.timeframe, strategy: p.strategy,
    candles: candles.length,
    params: p.strategy === "ema_cross"
      ? { fastPeriod: p.fastPeriod, slowPeriod: p.slowPeriod, ma: p.useSma ? "sma" : "ema", feeRate: p.feeRate }
      : { rsiPeriod: p.rsiPeriod, rsiBuyBelow: p.rsiBuyBelow, rsiSellAbove: p.rsiSellAbove, feeRate: p.feeRate },
    initialBalance: p.initialBalance, finalEquity,
    returnPct: ((finalEquity - p.initialBalance) / p.initialBalance) * 100,
    buyHoldEquity,
    buyHoldReturnPct: ((buyHoldEquity - p.initialBalance) / p.initialBalance) * 100,
    beatsBuyHold: finalEquity > buyHoldEquity,
    closedTrades: trades.length,
    openPosition: position ? { amount: position.amount, entry: position.entry } : null,
    wins: wins.length, losses: losses.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    trades: trades.slice(-50),
    equityCurve,
    caveats: [
      "Sin slippage: entradas y salidas asumen ejecución al cierre de la vela.",
      "Una sola posición a la vez, sin apalancamiento ni cortos.",
      "Rendimiento pasado sobre una ventana concreta; no es predictivo.",
    ],
  };
}
