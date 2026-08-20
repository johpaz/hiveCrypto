/**
 * Motor de paper trading.
 *
 * Cuenta virtual con fills calculados contra el order book REAL del exchange,
 * para que el slippage sea representativo. Una orden de mercado consume niveles
 * del libro hasta completar la cantidad; si el libro no alcanza, se llena
 * parcialmente en vez de inventar liquidez.
 *
 * El estado vive en memoria detrás de la interfaz `PaperStore`. La
 * implementación por defecto (`InMemoryPaperStore`) sirve para el servidor
 * standalone; hiveCrypto la sustituye por una respaldada en HiveDB para que el
 * portafolio sobreviva a los reinicios.
 */

export type Side = "buy" | "sell";
export type OrderType = "market" | "limit";

export interface PaperAccount {
  id: string;
  /** Moneda de cotización de la cuenta (USDT por defecto). */
  quote: string;
  /** Saldo disponible en la moneda de cotización. */
  balance: number;
  /** Saldo inicial, para calcular el rendimiento total. */
  initialBalance: number;
  createdAt: string;
}

export interface PaperPosition {
  accountId: string;
  symbol: string;
  /** Cantidad en la moneda base. Positiva = largo. Este motor no abre cortos. */
  amount: number;
  /** Precio promedio de entrada. */
  entryPrice: number;
  openedAt: string;
}

export interface PaperFill {
  price: number;
  amount: number;
}

export interface PaperTrade {
  id: string;
  accountId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  amount: number;
  /** Precio promedio de ejecución. */
  price: number;
  notional: number;
  fee: number;
  /** PnL realizado. Sólo lo llevan las ventas. */
  realizedPnl?: number;
  ts: string;
  fills: PaperFill[];
  /** Diferencia porcentual entre el mejor precio del libro y el promedio logrado. */
  slippagePct: number;
}

export interface OrderBook {
  bids: [number, number][];
  asks: [number, number][];
}

export interface PaperStore {
  getAccount(id: string): Promise<PaperAccount | null>;
  putAccount(a: PaperAccount): Promise<void>;
  listPositions(accountId: string): Promise<PaperPosition[]>;
  getPosition(accountId: string, symbol: string): Promise<PaperPosition | null>;
  putPosition(p: PaperPosition): Promise<void>;
  deletePosition(accountId: string, symbol: string): Promise<void>;
  appendTrade(t: PaperTrade): Promise<void>;
  listTrades(accountId: string, limit?: number): Promise<PaperTrade[]>;
}

export class InMemoryPaperStore implements PaperStore {
  private accounts = new Map<string, PaperAccount>();
  private positions = new Map<string, PaperPosition>();
  private trades: PaperTrade[] = [];

  private posKey(a: string, s: string) { return `${a}::${s}`; }

  async getAccount(id: string) { return this.accounts.get(id) ?? null; }
  async putAccount(a: PaperAccount) { this.accounts.set(a.id, a); }
  async listPositions(accountId: string) {
    return [...this.positions.values()].filter(p => p.accountId === accountId);
  }
  async getPosition(accountId: string, symbol: string) {
    return this.positions.get(this.posKey(accountId, symbol)) ?? null;
  }
  async putPosition(p: PaperPosition) { this.positions.set(this.posKey(p.accountId, p.symbol), p); }
  async deletePosition(accountId: string, symbol: string) {
    this.positions.delete(this.posKey(accountId, symbol));
  }
  async appendTrade(t: PaperTrade) { this.trades.push(t); }
  async listTrades(accountId: string, limit = 100) {
    return this.trades.filter(t => t.accountId === accountId).slice(-limit);
  }
}

/**
 * Recorre el libro consumiendo niveles hasta cubrir `amount`.
 * Devuelve los fills reales; si la profundidad no alcanza, llena parcial.
 */
export function fillFromBook(book: OrderBook, side: Side, amount: number): PaperFill[] {
  // Una compra consume asks (ofertas de venta); una venta consume bids.
  const levels = side === "buy" ? book.asks : book.bids;
  const fills: PaperFill[] = [];
  let remaining = amount;

  for (const [price, available] of levels) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, available);
    if (take <= 0) continue;
    fills.push({ price, amount: take });
    remaining -= take;
  }
  return fills;
}

export function averagePrice(fills: PaperFill[]): number {
  const total = fills.reduce((s, f) => s + f.amount, 0);
  if (total === 0) return 0;
  return fills.reduce((s, f) => s + f.price * f.amount, 0) / total;
}

export interface ExecuteParams {
  account: PaperAccount;
  symbol: string;
  side: Side;
  amount: number;
  book: OrderBook;
  /** Comisión en fracción (0.001 = 0.1%). */
  feeRate?: number;
  now?: () => Date;
  idFactory?: () => string;
}

export interface ExecuteResult {
  trade: PaperTrade;
  account: PaperAccount;
  position: PaperPosition | null;
}

let tradeCounter = 0;

/**
 * Ejecuta una orden de mercado simulada contra el libro dado y devuelve el
 * nuevo estado. No escribe en el store: eso lo hace quien llama, para que la
 * función sea pura y testeable.
 */
export function executeMarketOrder(
  params: ExecuteParams,
  currentPosition: PaperPosition | null
): ExecuteResult {
  const {
    account, symbol, side, amount, book,
    feeRate = 0.001,
    now = () => new Date(),
    idFactory = () => `t${++tradeCounter}`,
  } = params;

  const fills = fillFromBook(book, side, amount);
  if (fills.length === 0) {
    throw new Error(`Sin liquidez en el libro de ${symbol} para ${side} ${amount}`);
  }

  const filledAmount = fills.reduce((s, f) => s + f.amount, 0);
  const avg = averagePrice(fills);
  const notional = avg * filledAmount;
  const fee = notional * feeRate;

  const bestPrice = side === "buy" ? book.asks[0]?.[0] : book.bids[0]?.[0];
  const slippagePct = bestPrice ? ((avg - bestPrice) / bestPrice) * 100 : 0;

  const ts = now().toISOString();
  let nextAccount = { ...account };
  let nextPosition: PaperPosition | null = currentPosition ? { ...currentPosition } : null;
  let realizedPnl: number | undefined;

  if (side === "buy") {
    const cost = notional + fee;
    if (cost > account.balance) {
      throw new Error(
        `Saldo insuficiente: la orden cuesta ${cost.toFixed(2)} ${account.quote} y hay ${account.balance.toFixed(2)}`
      );
    }
    nextAccount.balance = account.balance - cost;

    if (nextPosition) {
      // Promedio ponderado de la entrada al ampliar la posición.
      const totalAmount = nextPosition.amount + filledAmount;
      nextPosition.entryPrice =
        (nextPosition.entryPrice * nextPosition.amount + avg * filledAmount) / totalAmount;
      nextPosition.amount = totalAmount;
    } else {
      nextPosition = { accountId: account.id, symbol, amount: filledAmount, entryPrice: avg, openedAt: ts };
    }
  } else {
    if (!nextPosition || nextPosition.amount <= 0) {
      throw new Error(`No hay posición abierta en ${symbol} para vender`);
    }
    if (filledAmount > nextPosition.amount + 1e-12) {
      throw new Error(
        `Cantidad ${filledAmount} superior a la posición abierta (${nextPosition.amount}) — este motor no abre cortos`
      );
    }
    realizedPnl = (avg - nextPosition.entryPrice) * filledAmount - fee;
    nextAccount.balance = account.balance + notional - fee;
    nextPosition.amount -= filledAmount;
    if (nextPosition.amount <= 1e-12) nextPosition = null;
  }

  const trade: PaperTrade = {
    id: idFactory(),
    accountId: account.id,
    symbol, side, type: "market",
    amount: filledAmount,
    price: avg,
    notional, fee, realizedPnl, ts, fills, slippagePct,
  };

  return { trade, account: nextAccount, position: nextPosition };
}

export interface PerformanceMetrics {
  trades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalPnl: number;
  profitFactor: number | null;
  maxDrawdownPct: number;
  avgWin: number;
  avgLoss: number;
}

/** Métricas de rendimiento sobre los trades cerrados (los que realizaron PnL). */
export function performance(trades: PaperTrade[]): PerformanceMetrics {
  const closed = trades.filter(t => typeof t.realizedPnl === "number");
  const pnls = closed.map(t => t.realizedPnl!);
  const wins = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p < 0);

  const grossWin = wins.reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));

  // Curva de equity acumulada para el drawdown máximo.
  let equity = 0, peak = 0, maxDd = 0;
  for (const p of pnls) {
    equity += p;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }

  return {
    trades: trades.length,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: closed.length ? (wins.length / closed.length) * 100 : 0,
    totalPnl: pnls.reduce((s, p) => s + p, 0),
    // Sin pérdidas el profit factor es infinito; se devuelve null en vez de Infinity.
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    maxDrawdownPct: maxDd,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
  };
}
