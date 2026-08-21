export interface MCPConfig {
  servers?: Record<string, MCPServerConfig>;
}

export interface MCPServerConfig {
  /**
   * `stdio` y `http` son los transportes de la revisión 2026-07-28.
   * `sse` (HTTP+SSE, deprecado en la spec) y `websocket` (nunca fue parte de
   * ella) siguen aceptándose para no romper configuraciones existentes.
   */
  transport: "stdio" | "http" | "sse" | "websocket";
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}
