/**
 * Panel de portafolio simulado: equity, saldo, posiciones abiertas y su PnL.
 *
 * Cada cifra que se muestra aquí sale del mismo handler que usa el agente, así
 * que lo que el usuario ve en pantalla y lo que el agente reporta en el chat no
 * pueden discrepar.
 */

import { useState } from "react";
import type { AccountResult } from "@/lib/trading-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, Wallet, X } from "lucide-react";
import { fmtMoney, fmtPrice, fmtPct, fmtAmount, signClass } from "./format";

interface Props {
  account: AccountResult | null;
  loading: boolean;
  onClosePosition: (symbol: string) => Promise<void>;
  onSelectSymbol: (symbol: string) => void;
  onCreate: () => Promise<void>;
}

export function PortfolioPanel({ account, loading, onClosePosition, onSelectSymbol, onCreate }: Props) {
  const [closing, setClosing] = useState<string | null>(null);

  const close = async (symbol: string) => {
    setClosing(symbol);
    try { await onClosePosition(symbol); } finally { setClosing(null); }
  };

  if (!account) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" /> Portafolio simulado
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Todavía no hay una cuenta de práctica. Se crea con saldo virtual y todas las
            operaciones son simuladas: nunca tocan fondos reales.
          </p>
          <Button size="sm" onClick={onCreate} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Crear cuenta con 10.000 USDT
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { account: acc, equity, totalReturn, totalReturnPct, positions } = account;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" /> Portafolio simulado
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">Simulado</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Equity" value={fmtMoney(equity, acc.quote)} />
          <Stat label="Disponible" value={fmtMoney(acc.balance, acc.quote)} />
          <Stat
            label="Rendimiento"
            value={fmtPct(totalReturnPct)}
            sub={fmtMoney(totalReturn, acc.quote)}
            className={signClass(totalReturn)}
          />
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            Posiciones abiertas ({positions.length})
          </div>

          {positions.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Sin posiciones abiertas
            </p>
          ) : (
            <div className="space-y-1.5">
              {positions.map(p => (
                <div
                  key={p.symbol}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs"
                >
                  <button
                    className="min-w-0 flex-1 text-left hover:underline"
                    onClick={() => onSelectSymbol(p.symbol)}
                    title="Ver en el gráfico"
                  >
                    <div className="truncate font-medium">{p.symbol}</div>
                    <div className="tabular-nums text-muted-foreground">
                      {fmtAmount(p.amount)} @ {fmtPrice(p.entryPrice)}
                    </div>
                  </button>

                  <div className="text-right tabular-nums">
                    <div className={signClass(p.unrealizedPnl)}>
                      {fmtPct(p.unrealizedPnlPct)}
                    </div>
                    <div className={`text-[11px] ${signClass(p.unrealizedPnl)}`}>
                      {fmtMoney(p.unrealizedPnl, acc.quote)}
                    </div>
                  </div>

                  {/* Un precio obsoleto se marca: valorar a la entrada no es lo mismo
                      que valorar a mercado, y el usuario debe poder notarlo. */}
                  {p.priceStale && (
                    <Badge variant="outline" className="text-[9px]" title="No se pudo leer el precio actual; se valora a la entrada">
                      sin precio
                    </Badge>
                  )}

                  <Button
                    size="icon" variant="ghost" className="h-6 w-6 shrink-0"
                    onClick={() => close(p.symbol)}
                    disabled={closing === p.symbol}
                    title="Cerrar posición"
                  >
                    {closing === p.symbol
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <X className="h-3 w-3" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, className }: {
  label: string; value: string; sub?: string; className?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${className ?? ""}`}>{value}</div>
      {sub && <div className={`text-[11px] tabular-nums ${className ?? "text-muted-foreground"}`}>{sub}</div>}
    </div>
  );
}
