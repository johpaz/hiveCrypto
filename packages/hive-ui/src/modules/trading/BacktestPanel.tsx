/**
 * Panel de backtesting con curva de equity.
 *
 * La comparación contra comprar y mantener es la cifra principal, no un detalle:
 * un +40% en un mercado que subió 80% destruyó valor, y la UI debe dejarlo claro
 * de un vistazo en vez de celebrar el número absoluto.
 */

import { useState } from "react";
import type { BacktestResult } from "@/lib/trading-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, FlaskConical, Check, X } from "lucide-react";
import { fmtMoney, fmtPct, signClass } from "./format";

interface Props {
  symbol: string;
  timeframe: string;
  loading: boolean;
  result: BacktestResult | null;
  error: string | null;
  onRun: (params: Record<string, unknown>) => void;
}

export function BacktestPanel({ symbol, timeframe, loading, result, error, onRun }: Props) {
  const [strategy, setStrategy] = useState<"ema_cross" | "rsi_threshold">("ema_cross");
  const [fast, setFast] = useState("20");
  const [slow, setSlow] = useState("50");
  const [rsiBuy, setRsiBuy] = useState("30");
  const [rsiSell, setRsiSell] = useState("70");

  const run = () => onRun({
    symbol, timeframe, strategy,
    fastPeriod: Number(fast), slowPeriod: Number(slow),
    rsiBuyBelow: Number(rsiBuy), rsiSellAbove: Number(rsiSell),
  });

  const invalidPeriods = strategy === "ema_cross" && Number(fast) >= Number(slow);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4" /> Backtest — {symbol} {timeframe}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-1.5">
          <Button
            size="sm" variant={strategy === "ema_cross" ? "secondary" : "ghost"}
            className="h-7 flex-1 text-[11px]"
            onClick={() => setStrategy("ema_cross")}
          >
            Cruce de medias
          </Button>
          <Button
            size="sm" variant={strategy === "rsi_threshold" ? "secondary" : "ghost"}
            className="h-7 flex-1 text-[11px]"
            onClick={() => setStrategy("rsi_threshold")}
          >
            Umbral de RSI
          </Button>
        </div>

        {strategy === "ema_cross" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Media rápida" value={fast} onChange={setFast} />
            <Field label="Media lenta" value={slow} onChange={setSlow} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Compra bajo" value={rsiBuy} onChange={setRsiBuy} />
            <Field label="Vende sobre" value={rsiSell} onChange={setRsiSell} />
          </div>
        )}

        {invalidPeriods && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            La media rápida debe ser menor que la lenta.
          </p>
        )}

        <Button className="w-full" size="sm" onClick={run} disabled={loading || invalidPeriods}>
          {loading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Ejecutar backtest
        </Button>

        {error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {result && (
          <div className="space-y-3">
            <div
              className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs ${
                result.beatsBuyHold
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-amber-500/30 bg-amber-500/5"
              }`}
            >
              {result.beatsBuyHold
                ? <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                : <X className="h-4 w-4 shrink-0 text-amber-500" />}
              <span>
                {result.beatsBuyHold
                  ? "La estrategia superó a comprar y mantener"
                  : "La estrategia NO superó a comprar y mantener"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Estrategia" value={fmtPct(result.returnPct)} className={signClass(result.returnPct)} />
              <Metric label="Comprar y mantener" value={fmtPct(result.buyHoldReturnPct)} className={signClass(result.buyHoldReturnPct)} />
              <Metric label="Operaciones" value={String(result.closedTrades)} sub={`${result.wins}G / ${result.losses}P`} />
              <Metric
                label="Profit factor"
                value={result.profitFactor === null ? "sin pérdidas" : result.profitFactor.toFixed(2)}
              />
            </div>

            <EquityCurve result={result} />

            {result.closedTrades < 20 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Sólo {result.closedTrades} operaciones cerradas: muestra insuficiente para concluir.
              </p>
            )}

            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">Limitaciones del método</summary>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5">
                {result.caveats.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Curva de equity de la estrategia contra la línea del capital inicial. */
function EquityCurve({ result }: { result: BacktestResult }) {
  const pts = result.equityCurve;
  if (pts.length < 2) return null;

  const W = 600, H = 110, P = 4;
  const values = pts.map(p => p.equity);
  const lo = Math.min(...values, result.initialBalance);
  const hi = Math.max(...values, result.initialBalance);
  const span = hi - lo || 1;

  const x = (i: number) => P + (i / (pts.length - 1)) * (W - P * 2);
  const y = (v: number) => P + (H - P * 2) - ((v - lo) / span) * (H - P * 2);

  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(" ");
  const up = result.finalEquity >= result.initialBalance;
  const color = up ? "#16a34a" : "#dc2626";

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Curva de equity</span>
        <span className="tabular-nums">
          {fmtMoney(result.initialBalance)} → {fmtMoney(result.finalEquity)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H }}>
        {/* Línea del capital inicial: por encima es ganancia, por debajo pérdida */}
        <line
          x1={P} x2={W - P} y1={y(result.initialBalance)} y2={y(result.initialBalance)}
          stroke="currentColor" strokeOpacity={0.2} strokeWidth={1} strokeDasharray="4 3"
        />
        <path d={`${d} L${x(pts.length - 1)},${H - P} L${x(0)},${H - P} Z`} fill={color} fillOpacity={0.08} />
        <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <Input
        type="number" value={value}
        onChange={e => onChange(e.target.value)}
        className="h-7 text-xs tabular-nums"
      />
    </div>
  );
}

function Metric({ label, value, sub, className }: {
  label: string; value: string; sub?: string; className?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${className ?? ""}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
