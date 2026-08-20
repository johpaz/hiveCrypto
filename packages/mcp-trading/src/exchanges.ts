/**
 * Factory de instancias CCXT.
 *
 * Dos tipos de instancia, deliberadamente separados:
 *
 *  - `getPublicExchange()`  — sin credenciales. Sólo endpoints públicos
 *    (ticker, OHLCV, order book, trades). Apunta a producción porque los datos
 *    de mercado del testnet no sirven para analizar nada real.
 *
 *  - `getPrivateExchange()` — con credenciales y **siempre** en sandbox.
 *    `setSandboxMode(true)` se llama en el constructor y después se verifica;
 *    si el exchange no soporta sandbox, se lanza en vez de caer a producción.
 *
 * La separación es el punto: la instancia que tiene llaves nunca puede apuntar
 * a mainnet, y la instancia que apunta a mainnet nunca tiene llaves.
 */

import ccxt from "ccxt";

export interface ExchangeCredentials {
  apiKey: string;
  secret: string;
  password?: string;
}

const publicCache = new Map<string, any>();
const privateCache = new Map<string, any>();

function assertSupported(id: string): void {
  if (!(ccxt as any).exchanges?.includes(id)) {
    throw new Error(`Exchange desconocido para CCXT: "${id}"`);
  }
}

/** Instancia pública (sin llaves) para datos de mercado. */
export function getPublicExchange(id: string): any {
  const key = id;
  const cached = publicCache.get(key);
  if (cached) return cached;

  assertSupported(id);
  const Ctor = (ccxt as any)[id];
  const ex = new Ctor({ enableRateLimit: true, timeout: 20000 });
  publicCache.set(key, ex);
  return ex;
}

/**
 * Instancia privada (con llaves) SIEMPRE en sandbox/testnet.
 *
 * Lanza si el exchange no expone URLs de sandbox: preferimos fallar a operar
 * accidentalmente contra producción.
 */
export function getPrivateExchange(id: string, creds: ExchangeCredentials): any {
  const key = id;
  const cached = privateCache.get(key);
  if (cached) return cached;

  assertSupported(id);
  const Ctor = (ccxt as any)[id];
  const ex = new Ctor({
    apiKey: creds.apiKey,
    secret: creds.secret,
    ...(creds.password ? { password: creds.password } : {}),
    enableRateLimit: true,
    timeout: 20000,
  });

  if (typeof ex.setSandboxMode !== "function") {
    throw new Error(`El exchange "${id}" no soporta setSandboxMode en esta versión de CCXT`);
  }
  // Debe llamarse antes de cualquier otra llamada.
  ex.setSandboxMode(true);

  // Verificación defensiva: CCXT marca `sandbox`/`urls.api` al activar el modo.
  // Si algo cambia entre versiones, esto falla ruidosamente en vez de operar en
  // producción con llaves reales.
  if (ex.sandbox !== true && ex.options?.sandboxMode !== true) {
    throw new Error(
      `setSandboxMode(true) no dejó "${id}" en modo sandbox — se aborta para no operar contra producción`
    );
  }

  privateCache.set(key, ex);
  return ex;
}

/** Verifica que una instancia esté en sandbox. Usado por las tools antes de operar. */
export function assertSandbox(ex: any, id: string): void {
  if (ex.sandbox !== true && ex.options?.sandboxMode !== true) {
    throw new Error(`La instancia de "${id}" no está en modo sandbox — orden abortada`);
  }
}

/** Credenciales desde el entorno: <EXCHANGE>_API_KEY / <EXCHANGE>_SECRET / <EXCHANGE>_PASSWORD. */
export function credentialsFromEnv(
  id: string,
  env: Record<string, string | undefined> = process.env
): ExchangeCredentials | null {
  const prefix = id.toUpperCase();
  const apiKey = env[`${prefix}_API_KEY`];
  const secret = env[`${prefix}_SECRET`];
  if (!apiKey || !secret) return null;
  return { apiKey, secret, password: env[`${prefix}_PASSWORD`] };
}

/** Sólo para tests: limpia los caches de instancias. */
export function resetExchangeCache(): void {
  publicCache.clear();
  privateCache.clear();
}
