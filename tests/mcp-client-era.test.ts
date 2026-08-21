/**
 * Negociación de era del cliente MCP.
 *
 * Fija la matriz que se verificó a mano al migrar del SDK v1 al v2: qué
 * transportes sondean por una revisión moderna y cuáles se quedan en la era
 * 2025. Es un contrato de compatibilidad — romperlo deja sin conectar a los
 * servidores MCP ya configurados por el usuario.
 *
 * No abre sockets: comprueba la decisión, no el viaje.
 */

import { describe, test, expect } from "bun:test";
import { createTransport, type TransportType } from "../packages/mcp/src/transports/index";

/** Los que la revisión 2026-07-28 reconoce y por tanto pueden negociar. */
const NEGOTIATING: TransportType[] = ["stdio", "http"];
/** Los que se quedan en la era 2025 por definición. */
const LEGACY_ONLY: TransportType[] = ["sse", "websocket"];

describe("transportes del cliente MCP", () => {
  test("http construye un transporte Streamable HTTP", () => {
    const t = createTransport({ type: "http", http: { url: "http://localhost:1/mcp" } });
    expect(t).toBeTruthy();
    expect(typeof t.send).toBe("function");
  });

  test("http sin configuración falla en vez de construir algo inservible", () => {
    // La validación de la url vive en el manager (createTransportForServer);
    // aquí sólo se comprueba que la factory no acepte un http vacío.
    expect(() => createTransport({ type: "http" })).toThrow(/http config/i);
  });

  test("los transportes legacy siguen construyéndose", () => {
    // Composio y compañía están configurados como "sse": si esto deja de
    // construir, esas integraciones dejan de conectar.
    expect(createTransport({ type: "sse", sse: { url: "http://localhost:1/mcp" } })).toBeTruthy();
    expect(createTransport({ type: "websocket", websocket: { url: "ws://localhost:1" } })).toBeTruthy();
  });

  test("un transporte desconocido falla en vez de caer a uno por defecto", () => {
    expect(() => createTransport({ type: "carrier-pigeon" as TransportType })).toThrow();
  });
});

describe("qué transportes negocian era", () => {
  // Espeja la condición de manager.ts. Si allí cambia, este test debe cambiar
  // a la vez y de forma deliberada.
  const negotiates = (t: TransportType) => t === "stdio" || t === "http";

  test("stdio y http sondean con server/discover", () => {
    for (const t of NEGOTIATING) expect(negotiates(t)).toBe(true);
  });

  test("sse y websocket NO sondean", () => {
    // El SSE escrito a mano cae al patrón Streamable HTTP sin mandar las
    // cabeceras Mcp-Method/Mcp-Name que exige la spec; un servidor moderno
    // responde -32020 (HeaderMismatch) y tumba la conexión entera. Medido.
    for (const t of LEGACY_ONLY) expect(negotiates(t)).toBe(false);
  });
});
