/**
 * MCP Manager Singleton
 * 
 * Provides global access to the MCP Manager instance
 */

import type { MCPClientManager } from "@johpaz/hivecrypto-mcp";

let _mcpManager: MCPClientManager | null = null;

export function setMCPManager(m: MCPClientManager): void {
  _mcpManager = m;
}

export function getMCPManager(): MCPClientManager | null {
  return _mcpManager;
}

