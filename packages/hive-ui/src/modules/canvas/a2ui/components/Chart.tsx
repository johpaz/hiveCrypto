/**
 * Gráfico de velas dentro de una superficie A2UI.
 *
 * Deja al agente mostrar un mercado en la conversación en lugar de describirlo
 * con palabras. Reutiliza `CandlestickChart` —el mismo componente de la
 * pantalla de trading— para que un gráfico en el chat y uno en `/trading` se
 * lean igual.
 *
 * Las velas vienen del modelo de datos por JSON pointer, igual que cualquier
 * otra propiedad A2UI:
 *
 *   { "type": "Chart", "candles": {"path": "/analysis/candles"},
 *     "title": "BTC/USDT 4h", "rsi": {"path": "/analysis/rsi"} }
 */

import { useMemo } from "react";
import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolvePath, resolveDynamicString } from "../dataBinding";
import { CandlestickChart } from "@/modules/trading/CandlestickChart";
import type { Candle } from "@/lib/trading-api";

/**
 * Tope de velas. Un modelo de datos viaja entero por WebSocket en cada
 * actualización, así que una serie larga encarece cada cambio de la superficie.
 * Recortar por el final conserva lo reciente, que es lo que se comenta.
 */
export const MAX_CANDLES = 150;

/** Acepta el valor sólo si tiene forma de vela OHLCV de CCXT. */
export function toCandles(value: unknown): Candle[] {
  if (!Array.isArray(value)) return [];
  const out: Candle[] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length < 6) continue;
    if (row.slice(0, 6).some(n => typeof n !== "number" || !Number.isFinite(n))) continue;
    out.push(row.slice(0, 6) as Candle);
  }
  return out.slice(-MAX_CANDLES);
}

export function toSeries(value: unknown): (number | null)[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map(v => (typeof v === "number" && Number.isFinite(v) ? v : null))
    .slice(-MAX_CANDLES);
}

function readPath(prop: unknown, ctx: RenderCtx): unknown {
  if (prop && typeof prop === "object" && "path" in prop) {
    return resolvePath((prop as { path: string }).path, ctx.dataModel, ctx.scopeData);
  }
  return prop;
}

export function A2UIChart({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const candles = useMemo(() => toCandles(readPath(def.candles, ctx)), [def.candles, ctx]);
  const rsi = useMemo(() => toSeries(readPath(def.rsi, ctx)), [def.rsi, ctx]);

  const title = resolveDynamicString(def.title, ctx.dataModel, ctx.scopeData);

  // Un gráfico vacío es peor que ninguno: no dice nada y ocupa espacio.
  if (candles.length < 2) {
    return (
      <div className="rounded-xl border border-white/[0.08] px-3 py-6 text-center text-xs text-muted-foreground">
        Sin datos suficientes para el gráfico
      </div>
    );
  }

  // El sub-panel de RSI sólo aparece si el agente mandó la serie.
  const indicators = rsi
    ? ({ series: { rsi }, timeframe: typeof def.timeframe === "string" ? def.timeframe : undefined } as never)
    : null;

  return (
    <div
      className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02]"
      style={def.weight ? { flex: def.weight } : undefined}
    >
      {title && (
        <div className="border-b border-white/[0.06] px-3 py-2 text-xs font-medium">
          {title}
        </div>
      )}
      <div className="p-2">
        <CandlestickChart
          candles={candles}
          indicators={indicators}
          showVolume={def.showVolume !== false}
          showRsi={Boolean(rsi)}
          showEmas={false}
          height={rsi ? 260 : 200}
        />
      </div>
    </div>
  );
}
