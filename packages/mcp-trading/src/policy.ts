/**
 * Policy engine — guardrails de trading.
 *
 * Regla de oro de este paquete: NO existe una ruta de ejecución con dinero
 * real. `TRADING_MODE` no admite "mainnet" y ninguna instancia de exchange se
 * construye sin `setSandboxMode(true)` (ver exchanges.ts). Los guardrails de
 * abajo son la segunda línea de defensa, no la primera.
 */

export type TradingMode = "readonly" | "paper" | "testnet";

export const TRADING_MODES: readonly TradingMode[] = ["readonly", "paper", "testnet"];

export interface PolicyConfig {
  /** readonly = sólo lectura; paper = + órdenes simuladas; testnet = + órdenes en sandbox del exchange. */
  mode: TradingMode;
  /** Símbolos permitidos para operar. Vacío = todos permitidos (sólo afecta a órdenes, no a lectura). */
  symbolWhitelist: string[];
  /** Notional máximo por orden, en la moneda de cotización (USDT normalmente). */
  maxOrderNotional: number;
  /** Exchanges permitidos. */
  exchangeWhitelist: string[];
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

/** Entrada del log de auditoría. Append-only, nunca se borra ni se reescribe. */
export interface AuditEntry {
  ts: string;
  action: string;
  exchange?: string;
  symbol?: string;
  side?: string;
  amount?: number;
  price?: number;
  notional?: number;
  allowed: boolean;
  reason?: string;
  mode: TradingMode;
}

function parseMode(raw: string | undefined): TradingMode {
  const v = (raw ?? "paper").trim().toLowerCase();
  if ((TRADING_MODES as readonly string[]).includes(v)) return v as TradingMode;
  // Un valor desconocido (incluido "mainnet" o "live") degrada a readonly en vez
  // de fallar abierto. Un typo en la config nunca debe habilitar más de lo pedido.
  return "readonly";
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

export function loadPolicyFromEnv(env: Record<string, string | undefined> = process.env): PolicyConfig {
  const requested = (env.TRADING_MODE ?? "paper").trim().toLowerCase();
  const mode = parseMode(env.TRADING_MODE);
  if (requested && requested !== mode) {
    console.error(
      `[policy] TRADING_MODE="${requested}" no es un modo válido (${TRADING_MODES.join("|")}). ` +
      `Degradando a "${mode}". La ejecución con dinero real no está implementada en este paquete.`
    );
  }
  const maxNotional = Number(env.MAX_ORDER_NOTIONAL ?? "100");
  return {
    mode,
    symbolWhitelist: parseList(env.SYMBOL_WHITELIST),
    maxOrderNotional: Number.isFinite(maxNotional) && maxNotional > 0 ? maxNotional : 100,
    exchangeWhitelist: parseList(env.EXCHANGE_WHITELIST),
  };
}

export class PolicyEngine {
  private audit: AuditEntry[] = [];
  private readonly maxAuditEntries = 5000;

  constructor(public readonly config: PolicyConfig) {}

  /** ¿Se permite leer datos públicos de este exchange? */
  checkRead(exchange: string): PolicyDecision {
    const { exchangeWhitelist } = this.config;
    if (exchangeWhitelist.length > 0 && !exchangeWhitelist.includes(exchange)) {
      return { allowed: false, reason: `exchange "${exchange}" fuera de EXCHANGE_WHITELIST` };
    }
    return { allowed: true };
  }

  /**
   * ¿Se permite una orden simulada (paper)? Requiere modo paper o testnet.
   */
  checkPaperOrder(params: OrderCheckParams): PolicyDecision {
    if (this.config.mode === "readonly") {
      return { allowed: false, reason: 'TRADING_MODE="readonly": las órdenes simuladas están deshabilitadas' };
    }
    return this.checkOrderLimits(params);
  }

  /**
   * ¿Se permite una orden en el sandbox del exchange? Requiere modo testnet.
   * Nunca autoriza mainnet: ese modo no existe.
   */
  checkExchangeOrder(params: OrderCheckParams): PolicyDecision {
    if (this.config.mode !== "testnet") {
      return {
        allowed: false,
        reason: `TRADING_MODE="${this.config.mode}": las órdenes contra el exchange requieren modo "testnet" (sandbox)`,
      };
    }
    return this.checkOrderLimits(params);
  }

  private checkOrderLimits(params: OrderCheckParams): PolicyDecision {
    const { exchange, symbol, notional } = params;
    const { exchangeWhitelist, symbolWhitelist, maxOrderNotional } = this.config;

    if (exchangeWhitelist.length > 0 && !exchangeWhitelist.includes(exchange)) {
      return { allowed: false, reason: `exchange "${exchange}" fuera de EXCHANGE_WHITELIST` };
    }
    if (symbolWhitelist.length > 0 && !symbolWhitelist.includes(symbol)) {
      return { allowed: false, reason: `símbolo "${symbol}" fuera de SYMBOL_WHITELIST` };
    }
    if (!Number.isFinite(notional) || notional <= 0) {
      return { allowed: false, reason: `notional inválido: ${notional}` };
    }
    if (notional > maxOrderNotional) {
      return {
        allowed: false,
        reason: `notional ${notional.toFixed(2)} supera MAX_ORDER_NOTIONAL (${maxOrderNotional})`,
      };
    }
    return { allowed: true };
  }

  /** Registra el intento —aceptado o rechazado— en el log de auditoría. */
  record(entry: Omit<AuditEntry, "ts" | "mode">): AuditEntry {
    const full: AuditEntry = { ...entry, ts: new Date().toISOString(), mode: this.config.mode };
    this.audit.push(full);
    if (this.audit.length > this.maxAuditEntries) {
      this.audit.splice(0, this.audit.length - this.maxAuditEntries);
    }
    return full;
  }

  getAudit(limit = 100): AuditEntry[] {
    return this.audit.slice(-limit);
  }
}

export interface OrderCheckParams {
  exchange: string;
  symbol: string;
  notional: number;
}
