import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Transport } from "@modelcontextprotocol/client";

// CORRECCIÓN 1 — quitar extensión .ts de los imports
// Bun resuelve los módulos sin extensión correctamente
// Con .ts puede fallar en algunos contextos de build/bundle
import { SSETransport, type SSETransportConfig } from "./sse";
import { WebSocketTransport, type WebSocketTransportConfig } from "./websocket";

export { SSETransport, type SSETransportConfig };
export { WebSocketTransport, type WebSocketTransportConfig };

// CORRECCIÓN 2 — exportar StdioTransportConfig
// Estaba definido pero no exportado — el resto del código no puede importarlo
export interface StdioTransportConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Transportes soportados.
 *
 * `stdio` y `http` son los dos que la revisión 2026-07-28 reconoce. Los otros
 * dos siguen aquí por compatibilidad y no deberían elegirse para un servidor
 * nuevo:
 *
 *  - `sse`: HTTP+SSE quedó **deprecado** en la spec. Nuestra implementación a
 *    mano cae al patrón Streamable HTTP ante un 4xx, así que muchos servidores
 *    "sse" configurados en realidad ya hablan HTTP moderno — migrarlos a `http`
 *    es un cambio de una palabra en la config.
 *  - `websocket`: nunca formó parte de la especificación.
 */
export type TransportType = "stdio" | "http" | "sse" | "websocket";

export interface HttpTransportConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface TransportOptions {
  type: TransportType;
  stdio?: StdioTransportConfig;
  http?: HttpTransportConfig;
  sse?: SSETransportConfig;
  websocket?: WebSocketTransportConfig;
}

export function createTransport(options: TransportOptions): Transport {
  switch (options.type) {
    case "stdio": {
      if (!options.stdio) {
        throw new Error("stdio config required for stdio transport");
      }
      return new StdioClientTransport({
        command: options.stdio.command,
        args: options.stdio.args ?? [],
        env: options.stdio.env ?? (process.env as Record<string, string>),
      });
    }

    case "http": {
      if (!options.http) {
        throw new Error("http config required for Streamable HTTP transport");
      }
      // El transporte del SDK: sin session-id propio, sin reanudación a mano.
      // La negociación de era la hace el Client, no el transporte.
      return new StreamableHTTPClientTransport(new URL(options.http.url), {
        requestInit: options.http.headers ? { headers: options.http.headers } : undefined,
      });
    }

    case "sse": {
      if (!options.sse) {
        throw new Error("sse config required for SSE transport");
      }
      // CORRECCIÓN 3 — sin cast as unknown as Transport
      // SSETransport ahora implementa Transport directamente (implements Transport)
      // el cast doble era señal de que el tipo no estaba bien declarado en la clase
      return new SSETransport(options.sse);
    }

    case "websocket": {
      if (!options.websocket) {
        throw new Error("websocket config required for WebSocket transport");
      }
      // Igual — WebSocketTransport ahora implementa Transport directamente
      return new WebSocketTransport(options.websocket);
    }

    default: {
      // exhaustive check — TypeScript avisa si falta un caso
      const _exhaustive: never = options.type;
      throw new Error(`Unknown transport type: ${_exhaustive}`);
    }
  }
}