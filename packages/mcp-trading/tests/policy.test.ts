import { describe, expect, it } from "bun:test";
import { PolicyEngine, loadPolicyFromEnv, type PolicyConfig } from "../src/policy.ts";

const base: PolicyConfig = {
  mode: "paper",
  symbolWhitelist: [],
  maxOrderNotional: 100,
  exchangeWhitelist: [],
};

describe("policy — modos", () => {
  it("no acepta mainnet: degrada a readonly", () => {
    // El punto de este test: si alguien intenta habilitar dinero real por
    // configuración, el servidor debe cerrarse, no abrirse.
    const p = loadPolicyFromEnv({ TRADING_MODE: "mainnet" });
    expect(p.mode).toBe("readonly");
  });

  it("un modo desconocido degrada a readonly en vez de fallar abierto", () => {
    expect(loadPolicyFromEnv({ TRADING_MODE: "live" }).mode).toBe("readonly");
    expect(loadPolicyFromEnv({ TRADING_MODE: "yolo" }).mode).toBe("readonly");
  });

  it("acepta los tres modos válidos", () => {
    expect(loadPolicyFromEnv({ TRADING_MODE: "readonly" }).mode).toBe("readonly");
    expect(loadPolicyFromEnv({ TRADING_MODE: "paper" }).mode).toBe("paper");
    expect(loadPolicyFromEnv({ TRADING_MODE: "testnet" }).mode).toBe("testnet");
  });

  it("sin TRADING_MODE arranca en paper", () => {
    expect(loadPolicyFromEnv({}).mode).toBe("paper");
  });
});

describe("policy — órdenes paper", () => {
  it("readonly rechaza órdenes simuladas", () => {
    const e = new PolicyEngine({ ...base, mode: "readonly" });
    const d = e.checkPaperOrder({ exchange: "binance", symbol: "BTC/USDT", notional: 10 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("readonly");
  });

  it("paper permite dentro del límite", () => {
    const e = new PolicyEngine(base);
    expect(e.checkPaperOrder({ exchange: "binance", symbol: "BTC/USDT", notional: 99 }).allowed).toBe(true);
  });

  it("rechaza notional por encima del máximo", () => {
    const e = new PolicyEngine(base);
    const d = e.checkPaperOrder({ exchange: "binance", symbol: "BTC/USDT", notional: 101 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("MAX_ORDER_NOTIONAL");
  });

  it("rechaza símbolo fuera de la whitelist", () => {
    const e = new PolicyEngine({ ...base, symbolWhitelist: ["BTC/USDT"] });
    expect(e.checkPaperOrder({ exchange: "binance", symbol: "DOGE/USDT", notional: 10 }).allowed).toBe(false);
    expect(e.checkPaperOrder({ exchange: "binance", symbol: "BTC/USDT", notional: 10 }).allowed).toBe(true);
  });

  it("rechaza exchange fuera de la whitelist", () => {
    const e = new PolicyEngine({ ...base, exchangeWhitelist: ["binance"] });
    expect(e.checkPaperOrder({ exchange: "okx", symbol: "BTC/USDT", notional: 10 }).allowed).toBe(false);
  });

  it("rechaza notional inválido", () => {
    const e = new PolicyEngine(base);
    expect(e.checkPaperOrder({ exchange: "binance", symbol: "BTC/USDT", notional: 0 }).allowed).toBe(false);
    expect(e.checkPaperOrder({ exchange: "binance", symbol: "BTC/USDT", notional: NaN }).allowed).toBe(false);
    expect(e.checkPaperOrder({ exchange: "binance", symbol: "BTC/USDT", notional: -5 }).allowed).toBe(false);
  });
});

describe("policy — órdenes contra el exchange", () => {
  it("paper NO autoriza órdenes en el exchange", () => {
    const e = new PolicyEngine({ ...base, mode: "paper" });
    const d = e.checkExchangeOrder({ exchange: "binance", symbol: "BTC/USDT", notional: 10 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("testnet");
  });

  it("readonly NO autoriza órdenes en el exchange", () => {
    const e = new PolicyEngine({ ...base, mode: "readonly" });
    expect(e.checkExchangeOrder({ exchange: "binance", symbol: "BTC/USDT", notional: 10 }).allowed).toBe(false);
  });

  it("testnet autoriza dentro de los límites", () => {
    const e = new PolicyEngine({ ...base, mode: "testnet" });
    expect(e.checkExchangeOrder({ exchange: "binance", symbol: "BTC/USDT", notional: 50 }).allowed).toBe(true);
  });

  it("testnet sigue respetando el notional máximo", () => {
    const e = new PolicyEngine({ ...base, mode: "testnet" });
    expect(e.checkExchangeOrder({ exchange: "binance", symbol: "BTC/USDT", notional: 500 }).allowed).toBe(false);
  });
});

describe("policy — auditoría", () => {
  it("registra tanto aceptados como rechazados", () => {
    const e = new PolicyEngine(base);
    e.record({ action: "paper_order", symbol: "BTC/USDT", allowed: true });
    e.record({ action: "paper_order", symbol: "DOGE/USDT", allowed: false, reason: "fuera de whitelist" });
    const audit = e.getAudit();
    expect(audit).toHaveLength(2);
    expect(audit[0]!.allowed).toBe(true);
    expect(audit[1]!.allowed).toBe(false);
    expect(audit[1]!.reason).toBe("fuera de whitelist");
    expect(audit[0]!.mode).toBe("paper");
    expect(audit[0]!.ts).toBeTruthy();
  });
});
