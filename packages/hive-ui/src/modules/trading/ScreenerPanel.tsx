/** Screener: qué se está moviendo en el exchange, ordenable y clicable al gráfico. */

import { useState } from "react";
import type { ScanResult } from "@/lib/trading-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, Radar } from "lucide-react";
import { fmtPrice, fmtPct, fmtCompact, signClass } from "./format";

interface Props {
  scan: ScanResult | null;
  loading: boolean;
  onRefresh: (sortBy: string, direction: string) => void;
  onSelectSymbol: (symbol: string) => void;
}

const SORTS = [
  { key: "changePct", dir: "desc", label: "Mayores subidas" },
  { key: "changePct", dir: "asc", label: "Mayores caídas" },
  { key: "quoteVolume", dir: "desc", label: "Más volumen" },
  { key: "changePctAbs", dir: "desc", label: "Más movimiento" },
];

export function ScreenerPanel({ scan, loading, onRefresh, onSelectSymbol }: Props) {
  const [active, setActive] = useState(0);

  const pick = (i: number) => {
    setActive(i);
    onRefresh(SORTS[i]!.key, SORTS[i]!.dir);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radar className="h-4 w-4" /> Screener
          </CardTitle>
          <Button
            size="icon" variant="ghost" className="h-7 w-7"
            onClick={() => pick(active)} disabled={loading}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {SORTS.map((s, i) => (
            <Button
              key={s.label}
              size="sm"
              variant={active === i ? "secondary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => pick(i)}
            >
              {s.label}
            </Button>
          ))}
        </div>

        {!scan ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {loading ? "Escaneando el mercado…" : "Pulsa un filtro para escanear"}
          </p>
        ) : (
          <>
            <ScrollArea className="h-64">
              <table className="w-full text-[11px] tabular-nums">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-1.5 font-medium">Par</th>
                    <th className="pb-1.5 text-right font-medium">Precio</th>
                    <th className="pb-1.5 text-right font-medium">24h</th>
                    <th className="pb-1.5 text-right font-medium">Volumen</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.results.map(r => (
                    <tr
                      key={r.symbol}
                      className="cursor-pointer border-b border-border/40 hover:bg-muted/50"
                      onClick={() => onSelectSymbol(r.symbol)}
                    >
                      <td className="py-1.5 font-medium">{r.symbol}</td>
                      <td className="py-1.5 text-right">{r.last !== null ? fmtPrice(r.last) : "—"}</td>
                      <td className={`py-1.5 text-right ${signClass(r.changePct ?? 0)}`}>
                        {r.changePct !== null ? fmtPct(r.changePct) : "—"}
                      </td>
                      <td className="py-1.5 text-right text-muted-foreground">{fmtCompact(r.quoteVolume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            <p className="text-[10px] text-muted-foreground">
              {scan.results.length} de {scan.scanned} pares que pasan el filtro de volumen en {scan.exchange}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
