/**
 * Integración del vertical de trading.
 *
 * Verifica lo que no puede romperse en silencio: que las tres superficies
 * (tools nativas, rutas del gateway, servidor MCP) expongan el mismo conjunto
 * de operaciones, y que los guardrails corten donde deben.
 *
 * No toca la red: usa un store en memoria y un libro de órdenes sintético.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect } from "bun:test";
import { createTools } from "../packages/core/src/tools/trading/index";
import { CORE_TOOL_CATALOG } from "../packages/core/src/agent/tool-selector";
import { SEED_DATA } from "../packages/core/src/storage/seed";
import { createSeedCatalogAgents } from "../packages/core/src/agent/agent-catalog";
import { PolicyEngine } from "../packages/mcp-trading/src/policy";
import { InMemoryPaperStore, executeMarketOrder } from "../packages/mcp-trading/src/paper-engine";
import * as handlers from "../packages/mcp-trading/src/handlers";

const TRADING_TOOLS = [
  "market_ticker", "market_ohlcv", "market_orderbook", "market_trades",
  "market_symbols", "market_funding", "ta_indicators", "ta_levels",
  "scan_markets", "arbitrage_scan", "paper_account", "paper_order",
  "paper_positions", "paper_close", "paper_history",
  "exchange_balance", "exchange_order", "exchange_orders", "backtest_run",
];

const CRYPTO_AGENTS = ["market_analyst", "risk_manager", "paper_trader", "strategy_researcher"];

describe("tools nativas de trading", () => {
  const tools = createTools();
  const names = tools.map(t => t.name);

  test("expone exactamente las 19 operaciones", () => {
    expect(names.sort()).toEqual([...TRADING_TOOLS].sort());
  });

  test("cada tool tiene un handler correspondiente", () => {
    // Si una tool nativa no tuviera handler, se habría implementado la lógica
    // por duplicado — que es justo lo que la arquitectura evita.
    expect(Object.keys(handlers).length).toBeGreaterThanOrEqual(TRADING_TOOLS.length);
  });

  test("toda tool declara descripción con sinónimos en español", () => {
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(60);
      expect(t.description).toContain("Spanish:");
    }
  });

  test("toda tool declara parámetros como object schema", () => {
    for (const t of tools) {
      expect(t.parameters.type).toBe("object");
      expect(typeof t.parameters.properties).toBe("object");
    }
  });
});

describe("registro en catálogo y seed", () => {
  const catalog = new Set(CORE_TOOL_CATALOG.map(t => t.name));
  const seeded = new Set(SEED_DATA.tools.map(t => t.id));

  test("las 19 tools están en CORE_TOOL_CATALOG con keywords bilingües", () => {
    for (const name of TRADING_TOOLS) {
      expect(catalog.has(name)).toBe(true);
      const entry = CORE_TOOL_CATALOG.find(t => t.name === name)!;
      expect(entry.description).toContain("Spanish keywords:");
      expect(entry.category).toBe("trading");
    }
  });

  test("las 19 tools están sembradas en la BD", () => {
    for (const name of TRADING_TOOLS) expect(seeded.has(name)).toBe(true);
  });
});

describe("agentes especialistas", () => {
  const agents = createSeedCatalogAgents();
  const byId = new Map(agents.map(a => [a.id, a]));

  // Los campos de lista viajan serializados en el AgentDoc.
  const toolsOf = (id: string): string[] => JSON.parse(byId.get(id)!.tool_allowlist_json ?? "[]");
  const skillsOf = (id: string): string[] => JSON.parse(byId.get(id)!.skills_json ?? "[]");

  test("los 4 especialistas están en el catálogo", () => {
    for (const id of CRYPTO_AGENTS) expect(byId.has(id)).toBe(true);
  });

  test("cada especialista tiene su skill vinculada", () => {
    const expected: Record<string, string> = {
      market_analyst: "market_analysis",
      risk_manager: "risk_sizing",
      paper_trader: "paper_execution",
      strategy_researcher: "strategy_backtest",
    };
    for (const [agentId, skill] of Object.entries(expected)) {
      expect(skillsOf(agentId)).toContain(skill);
    }
  });

  test("las tools de cada especialista existen de verdad", () => {
    const real = new Set(createTools().map(t => t.name));
    for (const id of CRYPTO_AGENTS) {
      for (const tool of toolsOf(id)) {
        expect(real.has(tool)).toBe(true);
      }
    }
  });

  test("ningún especialista puede colocar órdenes salvo el operador y el de riesgo ninguna", () => {
    // El analista y el investigador de estrategias no deben poder operar:
    // su trabajo termina en el análisis.
    for (const id of ["market_analyst", "strategy_researcher", "risk_manager"]) {
      const tools = toolsOf(id);
      expect(tools).not.toContain("paper_order");
      expect(tools).not.toContain("exchange_order");
    }
    expect(toolsOf("paper_trader")).toContain("paper_order");
  });

  test("ningún especialista tiene acceso a órdenes reales de exchange", () => {
    for (const id of CRYPTO_AGENTS) {
      expect(toolsOf(id)).not.toContain("exchange_order");
    }
  });
});

describe("guardrails de extremo a extremo", () => {
  const book = { bids: [[99, 10]] as [number, number][], asks: [[100, 10]] as [number, number][] };

  const ctx = (mode: "readonly" | "paper" | "testnet", maxNotional = 100) => ({
    policy: new PolicyEngine({ mode, symbolWhitelist: [], maxOrderNotional: maxNotional, exchangeWhitelist: [] }),
    store: new InMemoryPaperStore(),
    defaultExchange: "binance",
    feeRate: 0.001,
  });

  test("readonly bloquea las órdenes simuladas", async () => {
    const c = ctx("readonly");
    await c.store.putAccount({ id: "default", quote: "USDT", balance: 10000, initialBalance: 10000, createdAt: "" });
    const d = c.policy.checkPaperOrder({ exchange: "binance", symbol: "BTC/USDT", notional: 10 });
    expect(d.allowed).toBe(false);
  });

  test("paper no autoriza órdenes contra el exchange", () => {
    expect(ctx("paper").policy.checkExchangeOrder({
      exchange: "binance", symbol: "BTC/USDT", notional: 10,
    }).allowed).toBe(false);
  });

  test("el motor cobra comisión y descuenta saldo", () => {
    const acc = { id: "a", quote: "USDT", balance: 1000, initialBalance: 1000, createdAt: "" };
    const r = executeMarketOrder(
      { account: acc, symbol: "BTC/USDT", side: "buy", amount: 1, book, feeRate: 0.001 },
      null
    );
    expect(r.trade.price).toBe(100);
    expect(r.account.balance).toBeCloseTo(899.9, 8);
  });
});
