/**
 * Panel de orden simulada.
 *
 * Muestra el notional estimado y lo contrasta con el límite de la política
 * ANTES de enviar: un rechazo silencioso del guardrail parece un bug, así que
 * el límite se hace visible mientras el usuario escribe.
 */

import { useState, useMemo } from "react";
import type { OrderResult, TradingStatus } from "@/lib/trading-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { fmtMoney, fmtPrice, fmtAmount, fmtPct } from "./format";
import { DelegateButton } from "./DelegateButton";

interface Props {
  symbol: string;
  price: number | null;
  quote: string;
  status: TradingStatus | null;
  disabled: boolean;
  onSubmit: (p: { side: "buy" | "sell"; notional: number }) => Promise<OrderResult | null>;
  onDelegate: (prompt: string) => void;
  agentConnected: boolean;
}

export function OrderPanel({ symbol, price, quote, status, disabled, onSubmit, onDelegate, agentConnected }: Props) {
  const [notional, setNotional] = useState("50");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);

  const value = Number(notional);
  const valid = Number.isFinite(value) && value > 0;
  const maxNotional = status?.limits.maxOrderNotional ?? Infinity;
  const overLimit = valid && value > maxNotional;

  const estimatedAmount = useMemo(
    () => (valid && price ? value / price : null),
    [valid, price, value]
  );

  const whitelisted =
    !status?.limits.symbolWhitelist.length ||
    status.limits.symbolWhitelist.includes(symbol);

  const blocked = disabled || !valid || overLimit || !whitelisted || status?.mode === "readonly";

  const submit = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await onSubmit({ side, notional: value });
      if (r) setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Orden simulada</CardTitle>
          <Badge variant="outline" className="text-[10px]">{symbol}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={side === "buy" ? "default" : "outline"}
            size="sm"
            className={side === "buy" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
            onClick={() => setSide("buy")}
          >
            <ArrowUpCircle className="mr-1.5 h-3.5 w-3.5" /> Comprar
          </Button>
          <Button
            variant={side === "sell" ? "default" : "outline"}
            size="sm"
            className={side === "sell" ? "bg-red-600 hover:bg-red-700" : ""}
            onClick={() => setSide("sell")}
          >
            <ArrowDownCircle className="mr-1.5 h-3.5 w-3.5" /> Vender
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notional" className="text-xs">Importe ({quote})</Label>
          <Input
            id="notional" type="number" min="0" step="10"
            value={notional}
            onChange={e => setNotional(e.target.value)}
            className="h-8 tabular-nums"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {estimatedAmount !== null
                ? `≈ ${fmtAmount(estimatedAmount)} ${symbol.split("/")[0]}`
                : "Esperando precio"}
            </span>
            <span className={overLimit ? "text-red-500" : ""}>
              Máx {fmtMoney(maxNotional, quote)}
            </span>
          </div>
        </div>

        {price !== null && (
          <div className="flex justify-between rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] tabular-nums">
            <span className="text-muted-foreground">Precio de referencia</span>
            <span>{fmtPrice(price)}</span>
          </div>
        )}

        {overLimit && (
          <Alert>
            El importe supera el límite por orden ({fmtMoney(maxNotional, quote)}). Redúcelo o
            cambia <code className="text-[10px]">MAX_ORDER_NOTIONAL</code>.
          </Alert>
        )}

        {!whitelisted && (
          <Alert>
            {symbol} no está en la whitelist de símbolos configurada.
          </Alert>
        )}

        {status?.mode === "readonly" && (
          <Alert>
            El modo es <strong>readonly</strong>: las órdenes simuladas están deshabilitadas.
          </Alert>
        )}

        <Button className="w-full" size="sm" onClick={submit} disabled={blocked || busy}>
          {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {side === "buy" ? "Comprar" : "Vender"} simulado
        </Button>

        {/* Delegar en vez de ejecutar: el agente dimensiona o razona antes de
            operar, en lugar de mandar la orden tal cual. */}
        <div className="grid grid-cols-2 gap-2">
          <DelegateButton
            prompt={`¿Cuánto debería invertir en ${symbol} con 1% de riesgo? Dame tamaño, stop y relación riesgo-beneficio.`}
            onDelegate={onDelegate}
            disabled={!agentConnected}
            className="w-full text-[11px]"
          >
            Dimensionar
          </DelegateButton>
          <DelegateButton
            prompt={`${side === "buy" ? "Compra" : "Vende"} ${valid ? value : 50} ${quote} de ${symbol} en simulado`}
            onDelegate={onDelegate}
            disabled={!agentConnected || !valid}
            className="w-full text-[11px]"
          >
            Delegar orden
          </DelegateButton>
        </div>

        {error && <Alert>{error}</Alert>}

        {result && (
          <div className="space-y-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-2 text-[11px] tabular-nums">
            <div className="font-medium text-emerald-600 dark:text-emerald-400">
              Ejecutada — {result.trade.side === "buy" ? "compra" : "venta"} simulada
            </div>
            <Row label="Precio de fill" value={fmtPrice(result.trade.price)} />
            <Row label="Cantidad" value={fmtAmount(result.trade.amount)} />
            <Row label="Slippage" value={fmtPct(result.trade.slippagePct, 4)} />
            <Row label="Comisión" value={fmtMoney(result.trade.fee, quote)} />
            <Row label="Saldo" value={fmtMoney(result.balance, quote)} />
            {result.trade.realizedPnl !== undefined && (
              <Row label="PnL realizado" value={fmtMoney(result.trade.realizedPnl, quote)} />
            )}
            {result.partialFill && (
              <div className="pt-1 text-amber-600 dark:text-amber-400">
                Llenado parcial: {fmtAmount(result.filledAmount)} de {fmtAmount(result.requestedAmount)} —
                el libro no tenía más liquidez.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
