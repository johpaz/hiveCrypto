import { describe, expect, it } from "bun:test";
import {
  fillFromBook, averagePrice, executeMarketOrder, performance,
  InMemoryPaperStore, type OrderBook, type PaperAccount, type PaperPosition, type PaperTrade,
} from "../src/paper-engine.ts";

const account = (balance = 10_000): PaperAccount => ({
  id: "test", quote: "USDT", balance, initialBalance: 10_000,
  createdAt: "2026-01-01T00:00:00.000Z",
});

/** Libro escalonado: cada nivel más caro que el anterior, para provocar slippage. */
const book: OrderBook = {
  bids: [[99, 1], [98, 2], [97, 5]],
  asks: [[100, 1], [101, 2], [102, 5]],
};

const fixed = { now: () => new Date("2026-01-01T12:00:00.000Z"), idFactory: () => "t1" };

describe("fillFromBook", () => {
  it("una compra consume asks de abajo hacia arriba", () => {
    expect(fillFromBook(book, "buy", 2)).toEqual([
      { price: 100, amount: 1 },
      { price: 101, amount: 1 },
    ]);
  });

  it("una venta consume bids de arriba hacia abajo", () => {
    expect(fillFromBook(book, "sell", 2)).toEqual([
      { price: 99, amount: 1 },
      { price: 98, amount: 1 },
    ]);
  });

  it("llena parcial si el libro no da más, en vez de inventar liquidez", () => {
    const fills = fillFromBook(book, "buy", 100);
    expect(fills.reduce((s, f) => s + f.amount, 0)).toBe(8); // 1+2+5, todo el libro
  });

  it("no consume nada si la cantidad es cero", () => {
    expect(fillFromBook(book, "buy", 0)).toEqual([]);
  });
});

describe("averagePrice", () => {
  it("pondera por cantidad, no por número de fills", () => {
    expect(averagePrice([{ price: 100, amount: 1 }, { price: 200, amount: 9 }])).toBe(190);
  });

  it("devuelve 0 sin fills", () => {
    expect(averagePrice([])).toBe(0);
  });
});

describe("executeMarketOrder — compras", () => {
  it("abre posición y descuenta saldo con comisión", () => {
    const r = executeMarketOrder(
      { account: account(), symbol: "BTC/USDT", side: "buy", amount: 1, book, feeRate: 0.001, ...fixed },
      null
    );
    expect(r.trade.price).toBe(100);
    expect(r.trade.fee).toBeCloseTo(0.1, 10);       // 100 * 0.001
    expect(r.account.balance).toBeCloseTo(9899.9, 10); // 10000 - 100 - 0.1
    expect(r.position!.amount).toBe(1);
    expect(r.position!.entryPrice).toBe(100);
  });

  it("refleja el slippage al barrer varios niveles", () => {
    const r = executeMarketOrder(
      { account: account(), symbol: "BTC/USDT", side: "buy", amount: 3, book, feeRate: 0, ...fixed },
      null
    );
    // 1@100 + 2@101 = 302 / 3 = 100.667
    expect(r.trade.price).toBeCloseTo(100.667, 3);
    expect(r.trade.slippagePct).toBeGreaterThan(0);
    expect(r.trade.fills).toHaveLength(2);
  });

  it("promedia la entrada al ampliar una posición existente", () => {
    const existing: PaperPosition = {
      accountId: "test", symbol: "BTC/USDT", amount: 1, entryPrice: 50,
      openedAt: "2026-01-01T00:00:00.000Z",
    };
    const r = executeMarketOrder(
      { account: account(), symbol: "BTC/USDT", side: "buy", amount: 1, book, feeRate: 0, ...fixed },
      existing
    );
    expect(r.position!.amount).toBe(2);
    expect(r.position!.entryPrice).toBe(75); // (50*1 + 100*1) / 2
  });

  it("rechaza la compra si no alcanza el saldo", () => {
    expect(() =>
      executeMarketOrder(
        { account: account(50), symbol: "BTC/USDT", side: "buy", amount: 1, book, feeRate: 0, ...fixed },
        null
      )
    ).toThrow(/Saldo insuficiente/);
  });
});

describe("executeMarketOrder — ventas", () => {
  const openPosition: PaperPosition = {
    accountId: "test", symbol: "BTC/USDT", amount: 2, entryPrice: 50,
    openedAt: "2026-01-01T00:00:00.000Z",
  };

  it("realiza PnL y cierra la posición al vender todo", () => {
    const r = executeMarketOrder(
      { account: account(0), symbol: "BTC/USDT", side: "sell", amount: 2, book, feeRate: 0, ...fixed },
      openPosition
    );
    // 1@99 + 1@98 = 197 / 2 = 98.5 promedio; PnL = (98.5 - 50) * 2 = 97
    expect(r.trade.price).toBe(98.5);
    expect(r.trade.realizedPnl).toBeCloseTo(97, 10);
    expect(r.position).toBeNull();
    expect(r.account.balance).toBeCloseTo(197, 10);
  });

  it("una venta parcial deja el resto abierto a la misma entrada", () => {
    const r = executeMarketOrder(
      { account: account(0), symbol: "BTC/USDT", side: "sell", amount: 1, book, feeRate: 0, ...fixed },
      openPosition
    );
    expect(r.position!.amount).toBe(1);
    expect(r.position!.entryPrice).toBe(50);
  });

  it("no permite vender sin posición abierta", () => {
    expect(() =>
      executeMarketOrder(
        { account: account(), symbol: "BTC/USDT", side: "sell", amount: 1, book, feeRate: 0, ...fixed },
        null
      )
    ).toThrow(/No hay posición abierta/);
  });

  it("no permite vender más de lo abierto — este motor no abre cortos", () => {
    expect(() =>
      executeMarketOrder(
        { account: account(), symbol: "BTC/USDT", side: "sell", amount: 5, book, feeRate: 0, ...fixed },
        openPosition
      )
    ).toThrow(/no abre cortos/);
  });
});

describe("executeMarketOrder — libro vacío", () => {
  it("falla en vez de ejecutar a un precio inventado", () => {
    expect(() =>
      executeMarketOrder(
        { account: account(), symbol: "BTC/USDT", side: "buy", amount: 1, book: { bids: [], asks: [] }, ...fixed },
        null
      )
    ).toThrow(/Sin liquidez/);
  });
});

describe("performance", () => {
  const trade = (pnl?: number): PaperTrade => ({
    id: "x", accountId: "test", symbol: "BTC/USDT", side: pnl === undefined ? "buy" : "sell",
    type: "market", amount: 1, price: 100, notional: 100, fee: 0,
    realizedPnl: pnl, ts: "2026-01-01T00:00:00.000Z", fills: [], slippagePct: 0,
  });

  it("cuenta sólo los trades cerrados para el win rate", () => {
    const m = performance([trade(), trade(10), trade(-5), trade(20)]);
    expect(m.trades).toBe(4);
    expect(m.closedTrades).toBe(3);
    expect(m.wins).toBe(2);
    expect(m.losses).toBe(1);
    expect(m.winRatePct).toBeCloseTo(66.67, 1);
    expect(m.totalPnl).toBe(25);
  });

  it("profit factor = ganancia bruta / pérdida bruta", () => {
    expect(performance([trade(30), trade(-10)]).profitFactor).toBe(3);
  });

  it("devuelve null en profit factor si no hubo pérdidas, no Infinity", () => {
    expect(performance([trade(10), trade(20)]).profitFactor).toBeNull();
  });

  it("calcula el drawdown máximo sobre la curva de equity", () => {
    // equity: 100 -> 40 -> 90. Pico 100, valle 40 => drawdown 60%.
    expect(performance([trade(100), trade(-60), trade(50)]).maxDrawdownPct).toBeCloseTo(60, 5);
  });

  it("sin trades no divide por cero", () => {
    const m = performance([]);
    expect(m.winRatePct).toBe(0);
    expect(m.totalPnl).toBe(0);
    expect(m.maxDrawdownPct).toBe(0);
  });
});

describe("InMemoryPaperStore", () => {
  it("aísla posiciones por cuenta y símbolo", async () => {
    const store = new InMemoryPaperStore();
    await store.putPosition({ accountId: "a", symbol: "BTC/USDT", amount: 1, entryPrice: 100, openedAt: "" });
    await store.putPosition({ accountId: "b", symbol: "BTC/USDT", amount: 2, entryPrice: 200, openedAt: "" });
    expect((await store.listPositions("a"))).toHaveLength(1);
    expect((await store.getPosition("b", "BTC/USDT"))!.amount).toBe(2);
    await store.deletePosition("a", "BTC/USDT");
    expect(await store.getPosition("a", "BTC/USDT")).toBeNull();
    expect(await store.getPosition("b", "BTC/USDT")).not.toBeNull();
  });
});
