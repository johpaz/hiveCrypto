/**
 * Cliente tipado de la API de trading.
 *
 * Un solo endpoint despacha por acción, así que esto es sobre todo tipos: lo
 * que importa es que la UI y el gateway estén de acuerdo en la forma de los
 * datos, porque ambos vienen del mismo handler.
 */

import { apiClient } from "@/lib/api";

export type Candle = [number, number, number, number, number, number];

export interface Ticker {
  exchange: string; symbol: string;
  last: number | null; bid: number | null; ask: number | null;
  high24h: number | null; low24h: number | null;
  baseVolume: number | null; quoteVolume: number | null;
  changePct24h: number | null; timestamp: number | null;
}

export interface OhlcvResult {
  exchange: string; symbol: string; timeframe: string;
  count: number; candles: Candle[];
}

export type Series = (number | null)[];

export interface IndicatorsResult {
  exchange: string; symbol: string; timeframe: string;
  candles: number; price: number;
  latest: {
    rsi?: number | null;
    macd?: { macd: number | null; signal: number | null; histogram: number | null };
    ema?: Record<string, number | null>;
    sma?: Record<string, number | null>;
    bollinger?: { upper: number | null; middle: number | null; lower: number | null };
    atr?: number | null;
    vwap?: number | null;
  };
  series?: {
    rsi?: Series;
    macd?: { macd: Series; signal: Series; histogram: Series };
    bollinger?: { upper: Series; middle: Series; lower: Series };
    [key: string]: unknown;
  };
}

export interface Level { price: number; touches: number }

export interface LevelsResult {
  symbol: string; timeframe: string; price: number;
  nearestSupport: Level | null; nearestResistance: Level | null;
  support: Level[]; resistance: Level[];
}

export interface PositionRow {
  symbol: string; amount: number; entryPrice: number;
  markPrice: number; priceStale: boolean; value: number;
  unrealizedPnl: number; unrealizedPnlPct: number; openedAt?: string;
}

export interface AccountResult {
  account: { id: string; quote: string; balance: number; initialBalance: number; createdAt: string };
  equity: number; positionsValue: number;
  totalReturn: number; totalReturnPct: number;
  positions: PositionRow[];
}

export interface Fill { price: number; amount: number }

export interface Trade {
  id: string; accountId: string; symbol: string;
  side: "buy" | "sell"; type: string; amount: number; price: number;
  notional: number; fee: number; realizedPnl?: number;
  ts: string; fills: Fill[]; slippagePct: number;
}

export interface OrderResult {
  simulated: true; trade: Trade; balance: number;
  position: { symbol: string; amount: number; entryPrice: number } | null;
  requestedAmount: number; filledAmount: number; partialFill: boolean;
}

export interface Metrics {
  trades: number; closedTrades: number; wins: number; losses: number;
  winRatePct: number; totalPnl: number; profitFactor: number | null;
  maxDrawdownPct: number; avgWin: number; avgLoss: number;
}

export interface HistoryResult {
  accountId: string; balance: number; initialBalance: number;
  metrics: Metrics; trades: Trade[];
}

export interface ScanRow {
  symbol: string; last: number | null; changePct: number | null; quoteVolume: number;
}

export interface ScanResult {
  exchange: string; quote: string; scanned: number; results: ScanRow[];
}

export interface BacktestTrade {
  entryTs: number; exitTs: number; entry: number; exit: number;
  amount: number; pnl: number; pnlPct: number;
}

export interface BacktestResult {
  symbol: string; timeframe: string; strategy: string; candles: number;
  params: Record<string, unknown>;
  initialBalance: number; finalEquity: number; returnPct: number;
  buyHoldEquity: number; buyHoldReturnPct: number; beatsBuyHold: boolean;
  closedTrades: number; wins: number; losses: number;
  winRatePct: number; profitFactor: number | null; maxDrawdownPct: number;
  trades: BacktestTrade[];
  equityCurve: { ts: number; equity: number }[];
  caveats: string[];
}

export interface OrderBookResult {
  symbol: string; bids: [number, number][]; asks: [number, number][];
  spread: number | null; spreadPct: number | null;
}

export interface AuditEntry {
  ts: string; action: string; exchange?: string; symbol?: string;
  side?: string; amount?: number; price?: number; notional?: number;
  allowed: boolean; reason?: string; mode: string;
}

export interface TradingStatus {
  ok: true; mode: "readonly" | "paper" | "testnet";
  defaultExchange: string; feeRate: number;
  limits: { maxOrderNotional: number; symbolWhitelist: string[]; exchangeWhitelist: string[] };
  audit: AuditEntry[];
}

/** Error de negocio del backend (símbolo inexistente, guardrail, saldo). */
export class TradingError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
    this.name = "TradingError";
  }
}

async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  try {
    // showError: false — los errores se muestran dentro del panel que hizo la
    // llamada, no en un diálogo global que tapa el gráfico.
    return await apiClient<T>("/api/trading", {
      method: "POST",
      body: { action, params },
      showError: false,
    });
  } catch (err) {
    throw new TradingError(err instanceof Error ? err.message : String(err));
  }
}

export const tradingApi = {
  status: () => apiClient<TradingStatus>("/api/trading/status", { showError: false }),
  ticker: (p: { symbol: string; exchange?: string }) => call<Ticker>("ticker", p),
  ohlcv: (p: { symbol: string; timeframe?: string; limit?: number; exchange?: string }) =>
    call<OhlcvResult>("ohlcv", p),
  orderbook: (p: { symbol: string; depth?: number; exchange?: string }) =>
    call<OrderBookResult>("orderbook", p),
  indicators: (p: { symbol: string; timeframe?: string; limit?: number; exchange?: string }) =>
    call<IndicatorsResult>("indicators", p),
  levels: (p: { symbol: string; timeframe?: string; exchange?: string }) =>
    call<LevelsResult>("levels", p),
  scan: (p: { quote?: string; sortBy?: string; direction?: string; limit?: number; exchange?: string }) =>
    call<ScanResult>("scan", p),
  account: (p: { action?: "get" | "create"; accountId?: string; initialBalance?: number; exchange?: string } = {}) =>
    call<AccountResult>("account", p),
  order: (p: { symbol: string; side: "buy" | "sell"; amount?: number; notional?: number; exchange?: string }) =>
    call<OrderResult>("order", p),
  close: (p: { symbol: string; exchange?: string }) => call<OrderResult>("close", p),
  history: (p: { limit?: number } = {}) => call<HistoryResult>("history", p),
  backtest: (p: Record<string, unknown>) => call<BacktestResult>("backtest", p),
};
