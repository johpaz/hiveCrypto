/**
 * PaperStore respaldado en HiveDB.
 *
 * Sustituye al InMemoryPaperStore del paquete mcp-trading para que el
 * portafolio simulado sobreviva a los reinicios de la app. La interfaz es la
 * misma, así que el motor de paper trading no sabe cuál de los dos está usando.
 */

import { col } from "../../storage/hive.ts";
import type {
  PaperStore, PaperAccount, PaperPosition, PaperTrade,
} from "@johpaz/hivecrypto-mcp-trading/paper-engine";

const ACCOUNTS = "paperAccounts";
const POSITIONS = "paperPositions";
const TRADES = "paperTrades";

/** La clave de una posición combina cuenta y símbolo: una posición por par y cuenta. */
const posKey = (accountId: string, symbol: string) =>
  `${accountId}::${symbol}`.replace(/[^a-zA-Z0-9_:./-]/g, "_");

export class HiveDbPaperStore implements PaperStore {
  async getAccount(id: string): Promise<PaperAccount | null> {
    const c = await col<PaperAccount>(ACCOUNTS);
    return (await c.get(id))?.doc ?? null;
  }

  async putAccount(a: PaperAccount): Promise<void> {
    const c = await col<PaperAccount>(ACCOUNTS);
    await c.put(a.id, a);
  }

  async listPositions(accountId: string): Promise<PaperPosition[]> {
    const c = await col<PaperPosition>(POSITIONS);
    return (await c.scan({})).map(e => e.doc).filter(p => p.accountId === accountId);
  }

  async getPosition(accountId: string, symbol: string): Promise<PaperPosition | null> {
    const c = await col<PaperPosition>(POSITIONS);
    return (await c.get(posKey(accountId, symbol)))?.doc ?? null;
  }

  async putPosition(p: PaperPosition): Promise<void> {
    const c = await col<PaperPosition>(POSITIONS);
    await c.put(posKey(p.accountId, p.symbol), p);
  }

  async deletePosition(accountId: string, symbol: string): Promise<void> {
    const c = await col<PaperPosition>(POSITIONS);
    await c.delete(posKey(accountId, symbol));
  }

  async appendTrade(t: PaperTrade): Promise<void> {
    const c = await col<PaperTrade>(TRADES);
    // El id lleva el timestamp por delante para que el scan lexicográfico
    // devuelva los trades en orden cronológico sin tener que ordenar después.
    const key = `${t.accountId}::${Date.now().toString().padStart(15, "0")}::${t.id}`;
    await c.put(key, t);
  }

  async listTrades(accountId: string, limit = 100): Promise<PaperTrade[]> {
    const c = await col<PaperTrade>(TRADES);
    return (await c.scan({}))
      .map(e => e.doc)
      .filter(t => t.accountId === accountId)
      .slice(-limit);
  }
}
