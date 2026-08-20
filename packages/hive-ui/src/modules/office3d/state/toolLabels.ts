const FRIENDLY_TOOL_LABELS: Record<string, string> = {
  task_delegate: "Delegando tarea",
  task_status: "Consultando estado",
  web_search: "Buscando en la web",
  web_fetch: "Leyendo página web",
  browser_navigate: "Navegando",
  browser_click: "Haciendo clic",
  browser_type: "Escribiendo en la página",
  browser_screenshot: "Tomando captura",
  computer_use_task: "Operando el navegador",
  browser_extract: "Extrayendo datos",
  fs_read: "Leyendo archivo",
  fs_write: "Escribiendo archivo",
  fs_exists: "Verificando archivo",
  exec: "Ejecutando comando",
  search_knowledge: "Buscando herramientas",
  a2ui_create_surface: "Creando interfaz",
  a2ui_update_components: "Actualizando interfaz",
  a2ui_update_data_model: "Actualizando datos",
  memory_write: "Guardando en memoria",
  memory_read: "Leyendo memoria",
  memory_search: "Buscando en memoria",
  save_note: "Guardando nota",
  "cron.create": "Programando tarea",
  notify: "Enviando aviso",
  report_progress: "Reportando avance",

  // Trading
  market_ticker: "Consultando precio",
  market_ohlcv: "Descargando velas",
  market_orderbook: "Mirando el libro",
  market_trades: "Revisando el flujo",
  market_symbols: "Buscando el par",
  market_funding: "Consultando funding",
  ta_indicators: "Calculando indicadores",
  ta_levels: "Buscando soportes y resistencias",
  scan_markets: "Escaneando el mercado",
  arbitrage_scan: "Comparando exchanges",
  paper_account: "Consultando el portafolio",
  paper_order: "Ejecutando orden simulada",
  paper_positions: "Revisando posiciones",
  paper_close: "Cerrando posición",
  paper_history: "Revisando el historial",
  exchange_balance: "Consultando saldo en testnet",
  exchange_order: "Colocando orden en testnet",
  exchange_orders: "Revisando órdenes abiertas",
  backtest_run: "Corriendo el backtest",
};

export function humanizeTool(name: string | null | undefined): string | null {
  if (!name) return null;
  if (FRIENDLY_TOOL_LABELS[name]) return FRIENDLY_TOOL_LABELS[name];
  const prefix = name.split("__")[0];
  if (prefix && prefix !== name) return `Usando ${prefix}`;
  const spaced = name.replace(/[_.]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
