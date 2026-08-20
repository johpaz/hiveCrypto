/**
 * Página de trading: gráfico, indicadores, simulación y backtesting.
 *
 * Todo lo que se ve aquí viene de /api/trading, que delega en los mismos
 * handlers que usan los agentes. La UI no recalcula nada por su cuenta: si el
 * agente dice que el RSI está en 82, aquí se ve 82.
 */

import { useCallback, useEffect, useState } from "react";
import { tradingApi } from "@/lib/trading-api";
import type {
  AccountResult, BacktestResult, HistoryResult, IndicatorsResult,
  LevelsResult, OhlcvResult, ScanResult, Ticker, TradingStatus,
} from "@/lib/trading-api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { CandlestickChart } from "@/modules/trading/CandlestickChart";
import { PortfolioPanel } from "@/modules/trading/PortfolioPanel";
import { OrderPanel } from "@/modules/trading/OrderPanel";
import { HistoryPanel } from "@/modules/trading/HistoryPanel";
import { ScreenerPanel } from "@/modules/trading/ScreenerPanel";
import { BacktestPanel } from "@/modules/trading/BacktestPanel";
import { fmtPrice, fmtPct, fmtCompact, signClass } from "@/modules/trading/format";
import { AgentActivityStrip } from "@/modules/trading/AgentActivityStrip";
import { AgentPanel } from "@/modules/trading/AgentPanel";
import { DelegateButton } from "@/modules/trading/DelegateButton";
import { useAgentChat } from "@/hooks/useAgentChat";
import { FocusPrompt } from "@/modules/trading/FocusPrompt";
import type { TradingFocus } from "@/stores/canvasStore";

const TIMEFRAMES = ["15m", "1h", "4h", "1d"] as const;

/** Etiqueta y tono del modo de operación. El modo condiciona todo lo demás. */
const MODE_LABEL: Record<string, { text: string; tone: string }> = {
  readonly: { text: "Sólo lectura", tone: "border-slate-500/40 text-slate-500" },
  paper: { text: "Paper trading", tone: "border-emerald-500/40 text-emerald-500" },
  testnet: { text: "Testnet", tone: "border-amber-500/40 text-amber-500" },
};

export function TradingPage() {
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [symbolInput, setSymbolInput] = useState("BTC/USDT");
  const [timeframe, setTimeframe] = useState<string>("1h");

  const [status, setStatus] = useState<TradingStatus | null>(null);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [ohlcv, setOhlcv] = useState<OhlcvResult | null>(null);
  const [indicators, setIndicators] = useState<IndicatorsResult | null>(null);
  const [levels, setLevels] = useState<LevelsResult | null>(null);
  const [account, setAccount] = useState<AccountResult | null>(null);
  const [history, setHistory] = useState<HistoryResult | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);

  const [loadingChart, setLoadingChart] = useState(false);
  const [loadingScan, setLoadingScan] = useState(false);
  const [loadingBacktest, setLoadingBacktest] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  const [showBollinger, setShowBollinger] = useState(false);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(false);
  const [showLevels, setShowLevels] = useState(true);

  const quote = account?.account.quote ?? "USDT";

  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [agentLevels, setAgentLevels] = useState<{ support?: number; resistance?: number }>({});
  const { send: sendToAgent, isConnected: agentConnected } = useAgentChat();

  /**
   * Manda la frase al coordinador y abre el panel. Se abre siempre: delegar sin
   * ver la respuesta dejaría al usuario sin saber si pasó algo.
   */
  /** Aplica el foco pedido por el agente: símbolo, temporalidad y niveles. */
  const followAgentFocus = useCallback((focus: TradingFocus) => {
    if (focus.symbol !== symbol) {
      setSymbol(focus.symbol);
      setSymbolInput(focus.symbol);
    }
    if (focus.timeframe && focus.timeframe !== timeframe) setTimeframe(focus.timeframe);
    setAgentLevels({ support: focus.support, resistance: focus.resistance });
  }, [symbol, timeframe]);

  const delegate = useCallback((prompt: string) => {
    sendToAgent(prompt);
    setAgentPanelOpen(true);
  }, [sendToAgent]);

  // ── carga del gráfico ────────────────────────────────────────────────────
  const loadChart = useCallback(async (sym: string, tf: string) => {
    setLoadingChart(true);
    setChartError(null);
    try {
      // En paralelo: los cuatro son independientes y la latencia se nota.
      const [t, o, ind, lv] = await Promise.allSettled([
        tradingApi.ticker({ symbol: sym }),
        tradingApi.ohlcv({ symbol: sym, timeframe: tf, limit: 200 }),
        tradingApi.indicators({ symbol: sym, timeframe: tf, limit: 200 }),
        tradingApi.levels({ symbol: sym, timeframe: tf }),
      ]);

      if (t.status === "fulfilled") setTicker(t.value); else setTicker(null);
      if (o.status === "fulfilled") setOhlcv(o.value); else setOhlcv(null);
      if (ind.status === "fulfilled") setIndicators(ind.value); else setIndicators(null);
      // Los niveles son un extra: si fallan, el gráfico sigue siendo útil.
      if (lv.status === "fulfilled") setLevels(lv.value); else setLevels(null);

      if (o.status === "rejected") {
        setChartError(o.reason instanceof Error ? o.reason.message : String(o.reason));
      }
    } finally {
      setLoadingChart(false);
    }
  }, []);

  const loadAccount = useCallback(async () => {
    try {
      const [a, h] = await Promise.allSettled([
        tradingApi.account(),
        tradingApi.history({ limit: 100 }),
      ]);
      // Cuenta inexistente no es un error a mostrar: es el estado inicial.
      setAccount(a.status === "fulfilled" ? a.value : null);
      setHistory(h.status === "fulfilled" ? h.value : null);
    } catch { /* estado inicial sin cuenta */ }
  }, []);

  const loadScan = useCallback(async (sortBy = "changePct", direction = "desc") => {
    setLoadingScan(true);
    try {
      setScan(await tradingApi.scan({ sortBy, direction, limit: 25 }));
    } catch {
      setScan(null);
    } finally {
      setLoadingScan(false);
    }
  }, []);

  useEffect(() => {
    tradingApi.status().then(setStatus).catch(() => setStatus(null));
    loadAccount();
  }, [loadAccount]);

  useEffect(() => { loadChart(symbol, timeframe); }, [symbol, timeframe, loadChart]);

  const applySymbol = () => {
    const s = symbolInput.trim().toUpperCase();
    if (s && s !== symbol) setSymbol(s);
  };

  const selectSymbol = (s: string) => {
    setSymbol(s);
    setSymbolInput(s);
    // Los niveles que marcó el agente eran de otro par: dejan de aplicar.
    setAgentLevels({});
  };

  const createAccount = async () => {
    setLoadingAccount(true);
    try {
      await tradingApi.account({ action: "create", initialBalance: 10_000 });
      await loadAccount();
    } finally {
      setLoadingAccount(false);
    }
  };

  const submitOrder = async (p: { side: "buy" | "sell"; notional: number }) => {
    const r = await tradingApi.order({ symbol, side: p.side, notional: p.notional });
    await loadAccount();
    return r;
  };

  const closePosition = async (sym: string) => {
    await tradingApi.close({ symbol: sym });
    await loadAccount();
  };

  const runBacktest = async (params: Record<string, unknown>) => {
    setLoadingBacktest(true);
    setBacktestError(null);
    try {
      setBacktest(await tradingApi.backtest(params));
    } catch (err) {
      setBacktest(null);
      setBacktestError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingBacktest(false);
    }
  };

  const mode = MODE_LABEL[status?.mode ?? "paper"] ?? MODE_LABEL.paper!;
  const rejected = (status?.audit ?? []).filter(a => !a.allowed);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      {/* ── cabecera: símbolo, precio y modo ───────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Input
            value={symbolInput}
            onChange={e => setSymbolInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && applySymbol()}
            className="h-8 w-40 font-medium"
            placeholder="BTC/USDT"
            aria-label="Símbolo"
          />
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={applySymbol}>
            <Search className="h-3.5 w-3.5" />
          </Button>
        </div>

        {ticker?.last != null && (
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold tabular-nums">{fmtPrice(ticker.last)}</span>
            {ticker.changePct24h !== null && (
              <span className={`text-sm tabular-nums ${signClass(ticker.changePct24h)}`}>
                {fmtPct(ticker.changePct24h)}
              </span>
            )}
            {ticker.quoteVolume !== null && (
              <span className="text-xs text-muted-foreground">
                vol {fmtCompact(ticker.quoteVolume)}
              </span>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <AgentActivityStrip />
          <DelegateButton
            prompt={`Analiza ${symbol} en ${timeframe}`}
            onDelegate={delegate}
            disabled={!agentConnected}
            className="h-8"
          >
            Analizar con el agente
          </DelegateButton>
          <Badge variant="outline" className={`text-[10px] ${mode.tone}`}>{mode.text}</Badge>
          {status && (
            <Badge variant="outline" className="text-[10px]">{status.defaultExchange}</Badge>
          )}
          <Button
            size="icon" variant="ghost" className="h-8 w-8"
            onClick={() => loadChart(symbol, timeframe)} disabled={loadingChart}
          >
            {loadingChart
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Aviso permanente: nada de esto mueve dinero real. */}
      <div className="flex items-start gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Todas las operaciones de esta pantalla son <strong>simuladas</strong>: se llenan contra el
          libro de órdenes real para que el slippage sea representativo, pero nunca tocan fondos reales.
          {status && ` Límite por orden: ${status.limits.maxOrderNotional} ${quote}.`}
        </span>
      </div>

      <FocusPrompt currentSymbol={symbol} onFollow={followAgentFocus} />

      <Tabs defaultValue="grafico" className="flex-1">
        <TabsList>
          <TabsTrigger value="grafico">Gráfico</TabsTrigger>
          <TabsTrigger value="simulacion">Simulación</TabsTrigger>
          <TabsTrigger value="screener">Screener</TabsTrigger>
          <TabsTrigger value="backtest">Backtest</TabsTrigger>
          <TabsTrigger value="auditoria">
            Auditoría
            {rejected.length > 0 && (
              <span className="ml-1.5 rounded bg-amber-500/20 px-1 text-[10px] text-amber-600">
                {rejected.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── gráfico ──────────────────────────────────────────────────── */}
        <TabsContent value="grafico" className="mt-3 space-y-3">
          <Card>
            <CardContent className="space-y-3 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-1">
                  {TIMEFRAMES.map(tf => (
                    <Button
                      key={tf} size="sm"
                      variant={timeframe === tf ? "secondary" : "ghost"}
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setTimeframe(tf)}
                    >
                      {tf}
                    </Button>
                  ))}
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-3">
                  <Toggle id="bb" label="Bollinger" checked={showBollinger} onChange={setShowBollinger} />
                  <Toggle id="rsi" label="RSI" checked={showRsi} onChange={setShowRsi} />
                  <Toggle id="macd" label="MACD" checked={showMacd} onChange={setShowMacd} />
                  <Toggle id="lv" label="Niveles" checked={showLevels} onChange={setShowLevels} />
                </div>
              </div>

              {chartError ? (
                <div className="py-12 text-center text-sm text-muted-foreground">{chartError}</div>
              ) : (
                <CandlestickChart
                  candles={ohlcv?.candles ?? []}
                  indicators={indicators}
                  support={showLevels
                    ? (agentLevels.support !== undefined
                        ? [{ price: agentLevels.support, touches: 0 }]
                        : levels?.support ?? [])
                    : []}
                  resistance={showLevels
                    ? (agentLevels.resistance !== undefined
                        ? [{ price: agentLevels.resistance, touches: 0 }]
                        : levels?.resistance ?? [])
                    : []}
                  showBollinger={showBollinger}
                  showRsi={showRsi}
                  showMacd={showMacd}
                  height={showRsi && showMacd ? 560 : showRsi || showMacd ? 490 : 420}
                />
              )}
            </CardContent>
          </Card>

          <IndicatorStrip indicators={indicators} levels={levels} />
        </TabsContent>

        {/* ── simulación ───────────────────────────────────────────────── */}
        <TabsContent value="simulacion" className="mt-3">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <PortfolioPanel
                onDelegate={delegate}
                agentConnected={agentConnected}
                account={account}
                loading={loadingAccount}
                onClosePosition={closePosition}
                onSelectSymbol={selectSymbol}
                onCreate={createAccount}
              />
              <HistoryPanel history={history} quote={quote} />
            </div>
            <OrderPanel
              onDelegate={delegate}
              agentConnected={agentConnected}
              symbol={symbol}
              price={ticker?.last ?? null}
              quote={quote}
              status={status}
              disabled={!account}
              onSubmit={submitOrder}
            />
          </div>
        </TabsContent>

        {/* ── screener ─────────────────────────────────────────────────── */}
        <TabsContent value="screener" className="mt-3">
          <ScreenerPanel
            scan={scan}
            loading={loadingScan}
            onRefresh={loadScan}
            onSelectSymbol={selectSymbol}
          />
        </TabsContent>

        {/* ── backtest ─────────────────────────────────────────────────── */}
        <TabsContent value="backtest" className="mt-3">
          <BacktestPanel
            onDelegate={delegate}
            agentConnected={agentConnected}
            symbol={symbol}
            timeframe={timeframe}
            loading={loadingBacktest}
            result={backtest}
            error={backtestError}
            onRun={runBacktest}
          />
        </TabsContent>

        {/* ── auditoría ────────────────────────────────────────────────── */}
        <TabsContent value="auditoria" className="mt-3">
          <AuditPanel status={status} />
        </TabsContent>
      </Tabs>

      <AgentPanel open={agentPanelOpen} onOpenChange={setAgentPanelOpen} />
    </div>
  );
}

/** Fila de valores actuales de los indicadores, para leerlos sin pasar el cursor. */
function IndicatorStrip({ indicators, levels }: {
  indicators: IndicatorsResult | null; levels: LevelsResult | null;
}) {
  if (!indicators) return null;
  const l = indicators.latest;
  const rsi = l.rsi ?? null;

  return (
    <Card>
      <CardContent className="flex flex-wrap gap-x-6 gap-y-2 p-3 text-xs">
        {rsi !== null && (
          <Item
            label="RSI(14)"
            value={rsi.toFixed(1)}
            hint={rsi > 70 ? "sobrecompra" : rsi < 30 ? "sobreventa" : "neutral"}
            className={rsi > 70 ? "text-red-500" : rsi < 30 ? "text-emerald-500" : ""}
          />
        )}
        {l.macd?.histogram != null && (
          <Item
            label="MACD hist."
            value={l.macd.histogram.toFixed(2)}
            hint={l.macd.histogram >= 0 ? "momentum a favor" : "momentum en contra"}
            className={signClass(l.macd.histogram)}
          />
        )}
        {l.ema && Object.entries(l.ema).map(([k, v]) =>
          v == null ? null : (
            <Item key={k} label={k.toUpperCase()} value={fmtPrice(v)} />
          )
        )}
        {l.atr != null && <Item label="ATR" value={fmtPrice(l.atr)} hint="volatilidad" />}
        {levels?.nearestSupport && (
          <Item
            label="Soporte"
            value={fmtPrice(levels.nearestSupport.price)}
            hint={`${levels.nearestSupport.touches} toques`}
            className="text-emerald-500"
          />
        )}
        {levels?.nearestResistance && (
          <Item
            label="Resistencia"
            value={fmtPrice(levels.nearestResistance.price)}
            hint={`${levels.nearestResistance.touches} toques`}
            className="text-red-500"
          />
        )}
      </CardContent>
    </Card>
  );
}

function AuditPanel({ status }: { status: TradingStatus | null }) {
  if (!status || status.audit.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Sin intentos de orden registrados todavía. Aquí queda constancia de cada orden,
          aceptada o rechazada, con el motivo.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        <table className="w-full text-[11px] tabular-nums">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-1.5 font-medium">Fecha</th>
              <th className="pb-1.5 font-medium">Acción</th>
              <th className="pb-1.5 font-medium">Par</th>
              <th className="pb-1.5 text-right font-medium">Notional</th>
              <th className="pb-1.5 font-medium">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {[...status.audit].reverse().map((a, i) => (
              <tr key={i} className="border-b border-border/40">
                <td className="py-1.5 text-muted-foreground">
                  {new Date(a.ts).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="py-1.5">{a.action}</td>
                <td className="py-1.5">{a.symbol ?? "—"}</td>
                <td className="py-1.5 text-right">{a.notional != null ? a.notional.toFixed(2) : "—"}</td>
                <td className={`py-1.5 ${a.allowed ? "text-emerald-500" : "text-amber-500"}`}>
                  {a.allowed ? "aceptada" : `rechazada — ${a.reason}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Item({ label, value, hint, className }: {
  label: string; value: string; hint?: string; className?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-semibold tabular-nums ${className ?? ""}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Toggle({ id, label, checked, onChange }: {
  id: string; label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="scale-75" />
      <Label htmlFor={id} className="cursor-pointer text-[11px]">{label}</Label>
    </div>
  );
}

export default TradingPage;
