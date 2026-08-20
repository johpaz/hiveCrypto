/**
 * Gráfico de velas en SVG puro.
 *
 * Sin librería de charting: el bundle de la app de escritorio se sirve desde el
 * gateway local, así que una dependencia de CDN no cargaría y una librería de
 * charting completa añade cientos de KB para algo que aquí son cuatro escalas
 * y un path. Además así el tema claro/oscuro sale de las variables CSS del
 * producto en vez de un theme propio de la librería.
 *
 * Composición: panel de precio (velas + Bollinger + EMAs + niveles) arriba,
 * y sub-paneles opcionales de volumen, RSI y MACD abajo, compartiendo eje X.
 */

import { useMemo, useState, useRef, useCallback } from "react";
import type { Candle, IndicatorsResult, Level } from "@/lib/trading-api";
import { cn } from "@/lib/utils";

interface Props {
  candles: Candle[];
  indicators?: IndicatorsResult | null;
  support?: Level[];
  resistance?: Level[];
  showVolume?: boolean;
  showRsi?: boolean;
  showMacd?: boolean;
  showBollinger?: boolean;
  showEmas?: boolean;
  height?: number;
  className?: string;
}

const PAD = { top: 12, right: 62, bottom: 20, left: 8 };
const UP = "var(--trading-up, #16a34a)";
const DOWN = "var(--trading-down, #dc2626)";

/** Formatea un precio con los decimales que el rango de la serie hace útiles. */
function fmtPrice(v: number): string {
  const abs = Math.abs(v);
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return v.toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function fmtCompact(v: number): string {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(2);
}

function fmtTime(ts: number, timeframe?: string): string {
  const d = new Date(ts);
  // En intradía la fecha sobra y el reloj es lo informativo; en diario al revés.
  const intraday = timeframe ? /^\d+(m|h)$/.test(timeframe) : true;
  return intraday
    ? d.toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es", { day: "2-digit", month: "short", year: "2-digit" });
}

/** Convierte una serie con huecos en tramos continuos, para no unir por encima de los null. */
function segments(series: (number | null)[]): { i: number; v: number }[][] {
  const out: { i: number; v: number }[][] = [];
  let cur: { i: number; v: number }[] = [];
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v === null || v === undefined || !Number.isFinite(v)) {
      if (cur.length) { out.push(cur); cur = []; }
    } else {
      cur.push({ i, v });
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

export function CandlestickChart({
  candles,
  indicators,
  support = [],
  resistance = [],
  showVolume = true,
  showRsi = false,
  showMacd = false,
  showBollinger = false,
  showEmas = true,
  height = 420,
  className,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Alto de cada panel. El de precio se queda con lo que sobre.
  const volH = showVolume ? 52 : 0;
  const rsiH = showRsi ? 70 : 0;
  const macdH = showMacd ? 70 : 0;
  const priceH = Math.max(120, height - volH - rsiH - macdH - PAD.top - PAD.bottom);

  const W = 900; // viewBox fijo; el SVG escala con preserveAspectRatio
  const innerW = W - PAD.left - PAD.right;

  const geom = useMemo(() => {
    if (!candles.length) return null;

    const n = candles.length;
    const slot = innerW / n;
    const bodyW = Math.max(1, Math.min(slot * 0.7, 14));

    // La escala de precio incluye las bandas de Bollinger si se dibujan: si no,
    // las bandas se saldrían del panel en mercados volátiles.
    let lo = Infinity, hi = -Infinity;
    for (const k of candles) { if (k[3] < lo) lo = k[3]; if (k[2] > hi) hi = k[2]; }
    const bb = showBollinger ? indicators?.series?.bollinger : undefined;
    for (const s of [bb?.upper, bb?.lower]) {
      if (!s) continue;
      for (const v of s) { if (v == null) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    const span = hi - lo || hi || 1;
    const padY = span * 0.06;
    lo -= padY; hi += padY;

    const x = (i: number) => PAD.left + i * slot + slot / 2;
    const y = (p: number) => PAD.top + priceH - ((p - lo) / (hi - lo)) * priceH;

    const maxVol = Math.max(...candles.map(k => k[5]), 1);
    const volTop = PAD.top + priceH + 6;
    const vy = (v: number) => volTop + volH - (v / maxVol) * (volH - 6);

    const rsiTop = volTop + volH + (showRsi ? 8 : 0);
    const ry = (v: number) => rsiTop + rsiH - (v / 100) * rsiH;

    const macdTop = rsiTop + rsiH + (showMacd ? 8 : 0);
    const macdSeries = indicators?.series?.macd;
    let mLo = 0, mHi = 0;
    if (macdSeries) {
      for (const s of [macdSeries.macd, macdSeries.signal, macdSeries.histogram]) {
        for (const v of s ?? []) { if (v == null) continue; if (v < mLo) mLo = v; if (v > mHi) mHi = v; }
      }
    }
    const mSpan = (mHi - mLo) || 1;
    const my = (v: number) => macdTop + macdH - ((v - mLo) / mSpan) * macdH;

    return { n, slot, bodyW, lo, hi, x, y, vy, volTop, ry, rsiTop, my, macdTop, mLo, mHi, maxVol };
  }, [candles, indicators, showBollinger, showRsi, showMacd, innerW, priceH, volH, rsiH, macdH]);

  const totalH = PAD.top + priceH + volH + rsiH + macdH + PAD.bottom;

  const onMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!geom || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    // Coordenada del viewBox a partir del píxel real: el SVG escala con el contenedor.
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((vx - PAD.left) / geom.slot);
    setHover(i >= 0 && i < geom.n ? i : null);
  }, [geom]);

  if (!geom || !candles.length) {
    return (
      <div
        className={cn("flex items-center justify-center text-sm text-muted-foreground", className)}
        style={{ height }}
      >
        Sin datos para graficar
      </div>
    );
  }

  const bb = showBollinger ? indicators?.series?.bollinger : undefined;
  const rsiSeries = showRsi ? indicators?.series?.rsi : undefined;
  const macdSeries = showMacd ? indicators?.series?.macd : undefined;

  const emaKeys = showEmas
    ? Object.keys(indicators?.series ?? {}).filter(k => /^ema\d+$/.test(k)).sort(
        (a, b) => Number(a.slice(3)) - Number(b.slice(3))
      )
    : [];
  const EMA_COLORS = ["#f59e0b", "#3b82f6", "#a855f7", "#ec4899"];

  const path = (series: (number | null)[], toY: (v: number) => number) =>
    segments(series)
      .map(seg => seg.map((p, k) => `${k === 0 ? "M" : "L"}${geom.x(p.i).toFixed(1)},${toY(p.v).toFixed(1)}`).join(" "))
      .join(" ");

  const hoveredCandle = hover !== null ? candles[hover] : null;

  // Etiquetas del eje de precio: 5 marcas equiespaciadas.
  const priceTicks = Array.from({ length: 5 }, (_, i) => geom.lo + ((geom.hi - geom.lo) * i) / 4);

  return (
    <div className={cn("relative w-full", className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${totalH}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Gráfico de velas"
      >
        {/* Rejilla y eje de precio */}
        {priceTicks.map((p, i) => (
          <g key={`t${i}`}>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={geom.y(p)} y2={geom.y(p)}
              stroke="currentColor" strokeOpacity={0.08} strokeWidth={1}
            />
            <text
              x={W - PAD.right + 5} y={geom.y(p) + 3}
              fontSize={9} fill="currentColor" fillOpacity={0.55}
            >
              {fmtPrice(p)}
            </text>
          </g>
        ))}

        {/* Soportes y resistencias: línea punteada con la etiqueta del precio */}
        {support.slice(0, 3).map((l, i) => (
          <g key={`s${i}`}>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={geom.y(l.price)} y2={geom.y(l.price)}
              stroke={UP} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="5 4"
            />
            <text x={PAD.left + 3} y={geom.y(l.price) - 3} fontSize={8} fill={UP} fillOpacity={0.85}>
              S {fmtPrice(l.price)}
            </text>
          </g>
        ))}
        {resistance.slice(0, 3).map((l, i) => (
          <g key={`r${i}`}>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={geom.y(l.price)} y2={geom.y(l.price)}
              stroke={DOWN} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="5 4"
            />
            <text x={PAD.left + 3} y={geom.y(l.price) - 3} fontSize={8} fill={DOWN} fillOpacity={0.85}>
              R {fmtPrice(l.price)}
            </text>
          </g>
        ))}

        {/* Bandas de Bollinger: relleno entre superior e inferior */}
        {bb?.upper && bb?.lower && (
          <>
            <path d={path(bb.upper, geom.y)} fill="none" stroke="#8b5cf6" strokeOpacity={0.5} strokeWidth={1} />
            <path d={path(bb.lower, geom.y)} fill="none" stroke="#8b5cf6" strokeOpacity={0.5} strokeWidth={1} />
            <path d={path(bb.middle, geom.y)} fill="none" stroke="#8b5cf6" strokeOpacity={0.3} strokeWidth={1} strokeDasharray="3 3" />
          </>
        )}

        {/* Velas */}
        {candles.map((k, i) => {
          const [, o, h, l, c] = k;
          const up = c >= o;
          const color = up ? UP : DOWN;
          const yO = geom.y(o), yC = geom.y(c);
          const top = Math.min(yO, yC);
          const bodyH = Math.max(1, Math.abs(yC - yO));
          return (
            <g key={i} opacity={hover === null || hover === i ? 1 : 0.55}>
              <line
                x1={geom.x(i)} x2={geom.x(i)} y1={geom.y(h)} y2={geom.y(l)}
                stroke={color} strokeWidth={1}
              />
              <rect
                x={geom.x(i) - geom.bodyW / 2} y={top}
                width={geom.bodyW} height={bodyH}
                fill={color}
              />
            </g>
          );
        })}

        {/* EMAs por encima de las velas */}
        {emaKeys.map((key, idx) => {
          const s = indicators?.series?.[key] as (number | null)[] | undefined;
          if (!s) return null;
          return (
            <path
              key={key} d={path(s, geom.y)} fill="none"
              stroke={EMA_COLORS[idx % EMA_COLORS.length]} strokeOpacity={0.9} strokeWidth={1.4}
            />
          );
        })}

        {/* Volumen */}
        {showVolume && candles.map((k, i) => {
          const up = k[4] >= k[1];
          return (
            <rect
              key={`v${i}`}
              x={geom.x(i) - geom.bodyW / 2}
              y={geom.vy(k[5])}
              width={geom.bodyW}
              height={Math.max(1, geom.volTop + volH - geom.vy(k[5]))}
              fill={up ? UP : DOWN} fillOpacity={0.35}
            />
          );
        })}

        {/* RSI con sus bandas de 30 y 70 */}
        {rsiSeries && (
          <g>
            <rect
              x={PAD.left} y={geom.ry(70)} width={innerW} height={geom.ry(30) - geom.ry(70)}
              fill="currentColor" fillOpacity={0.04}
            />
            {[30, 50, 70].map(lv => (
              <g key={`rl${lv}`}>
                <line
                  x1={PAD.left} x2={W - PAD.right} y1={geom.ry(lv)} y2={geom.ry(lv)}
                  stroke="currentColor" strokeOpacity={lv === 50 ? 0.1 : 0.18}
                  strokeWidth={1} strokeDasharray={lv === 50 ? "2 4" : "4 3"}
                />
                <text x={W - PAD.right + 5} y={geom.ry(lv) + 3} fontSize={8} fill="currentColor" fillOpacity={0.5}>
                  {lv}
                </text>
              </g>
            ))}
            <path d={path(rsiSeries, geom.ry)} fill="none" stroke="#06b6d4" strokeWidth={1.4} />
            <text x={PAD.left + 3} y={geom.rsiTop + 10} fontSize={9} fill="currentColor" fillOpacity={0.65}>RSI</text>
          </g>
        )}

        {/* MACD: histograma + línea + señal */}
        {macdSeries && (
          <g>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={geom.my(0)} y2={geom.my(0)}
              stroke="currentColor" strokeOpacity={0.15} strokeWidth={1}
            />
            {macdSeries.histogram?.map((v, i) => {
              if (v == null) return null;
              const y0 = geom.my(0), y1 = geom.my(v);
              return (
                <rect
                  key={`h${i}`}
                  x={geom.x(i) - geom.bodyW / 2}
                  y={Math.min(y0, y1)}
                  width={geom.bodyW}
                  height={Math.max(1, Math.abs(y1 - y0))}
                  fill={v >= 0 ? UP : DOWN} fillOpacity={0.5}
                />
              );
            })}
            <path d={path(macdSeries.macd, geom.my)} fill="none" stroke="#3b82f6" strokeWidth={1.4} />
            <path d={path(macdSeries.signal, geom.my)} fill="none" stroke="#f59e0b" strokeWidth={1.4} />
            <text x={PAD.left + 3} y={geom.macdTop + 10} fontSize={9} fill="currentColor" fillOpacity={0.65}>MACD</text>
          </g>
        )}

        {/* Cursor */}
        {hover !== null && (
          <line
            x1={geom.x(hover)} x2={geom.x(hover)} y1={PAD.top} y2={totalH - PAD.bottom}
            stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} strokeDasharray="3 3"
          />
        )}

        {/* Eje de tiempo: primera, media y última */}
        {[0, Math.floor(geom.n / 2), geom.n - 1].map(i => (
          <text
            key={`x${i}`}
            x={geom.x(i)} y={totalH - 6}
            fontSize={8} fill="currentColor" fillOpacity={0.5}
            textAnchor={i === 0 ? "start" : i === geom.n - 1 ? "end" : "middle"}
          >
            {fmtTime(candles[i]![0], indicators?.timeframe)}
          </text>
        ))}
      </svg>

      {/* Tooltip de la vela bajo el cursor */}
      {hoveredCandle && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md border bg-popover/95 px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur">
          <div className="mb-0.5 font-medium text-muted-foreground">
            {fmtTime(hoveredCandle[0], indicators?.timeframe)}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
            <span className="text-muted-foreground">A</span><span>{fmtPrice(hoveredCandle[1])}</span>
            <span className="text-muted-foreground">Máx</span><span>{fmtPrice(hoveredCandle[2])}</span>
            <span className="text-muted-foreground">Mín</span><span>{fmtPrice(hoveredCandle[3])}</span>
            <span className="text-muted-foreground">C</span>
            <span className={hoveredCandle[4] >= hoveredCandle[1] ? "text-emerald-500" : "text-red-500"}>
              {fmtPrice(hoveredCandle[4])}
            </span>
            <span className="text-muted-foreground">Vol</span><span>{fmtCompact(hoveredCandle[5])}</span>
          </div>
        </div>
      )}

      {/* Leyenda de EMAs */}
      {emaKeys.length > 0 && (
        <div className="pointer-events-none absolute right-16 top-2 flex gap-2 text-[10px]">
          {emaKeys.map((k, i) => (
            <span key={k} className="flex items-center gap-1">
              <span
                className="inline-block h-0.5 w-3 rounded"
                style={{ background: EMA_COLORS[i % EMA_COLORS.length] }}
              />
              <span className="text-muted-foreground">{k.toUpperCase()}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
