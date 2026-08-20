/** Historial de operaciones simuladas con las métricas de rendimiento. */

import type { HistoryResult } from "@/lib/trading-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History } from "lucide-react";
import { fmtMoney, fmtPrice, fmtPct, fmtAmount, fmtDateTime, signClass } from "./format";

export function HistoryPanel({ history, quote }: { history: HistoryResult | null; quote: string }) {
  if (!history || history.trades.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Historial
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-center text-xs text-muted-foreground">
            Sin operaciones todavía. Las que ejecutes aparecerán aquí con sus métricas.
          </p>
        </CardContent>
      </Card>
    );
  }

  const m = history.metrics;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" /> Historial y métricas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="PnL total" value={fmtMoney(m.totalPnl, quote)} className={signClass(m.totalPnl)} />
          <Metric
            label="Aciertos"
            value={m.closedTrades ? `${m.winRatePct.toFixed(0)}%` : "—"}
            sub={`${m.wins}G / ${m.losses}P`}
          />
          <Metric
            label="Profit factor"
            // null = no hubo pérdidas. Mostrar "∞" sería engañoso con pocas operaciones.
            value={m.profitFactor === null ? "sin pérdidas" : m.profitFactor.toFixed(2)}
          />
          <Metric label="Drawdown máx." value={`${m.maxDrawdownPct.toFixed(1)}%`} />
        </div>

        {m.closedTrades > 0 && m.closedTrades < 20 && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            Sólo {m.closedTrades} operación{m.closedTrades === 1 ? "" : "es"} cerrada{m.closedTrades === 1 ? "" : "s"}:
            las métricas todavía no son concluyentes.
          </p>
        )}

        <ScrollArea className="h-56">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-1.5 font-medium">Fecha</th>
                <th className="pb-1.5 font-medium">Par</th>
                <th className="pb-1.5 font-medium">Lado</th>
                <th className="pb-1.5 text-right font-medium">Cantidad</th>
                <th className="pb-1.5 text-right font-medium">Precio</th>
                <th className="pb-1.5 text-right font-medium">PnL</th>
              </tr>
            </thead>
            <tbody>
              {[...history.trades].reverse().map(t => (
                <tr key={t.id + t.ts} className="border-b border-border/40">
                  <td className="py-1.5 text-muted-foreground">{fmtDateTime(t.ts)}</td>
                  <td className="py-1.5">{t.symbol}</td>
                  <td className={`py-1.5 ${t.side === "buy" ? "text-emerald-500" : "text-red-500"}`}>
                    {t.side === "buy" ? "compra" : "venta"}
                  </td>
                  <td className="py-1.5 text-right">{fmtAmount(t.amount)}</td>
                  <td className="py-1.5 text-right">{fmtPrice(t.price)}</td>
                  <td className={`py-1.5 text-right ${t.realizedPnl !== undefined ? signClass(t.realizedPnl) : "text-muted-foreground"}`}>
                    {t.realizedPnl !== undefined ? fmtMoney(t.realizedPnl, quote) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
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
