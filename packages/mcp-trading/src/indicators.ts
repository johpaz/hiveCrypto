/**
 * Indicadores técnicos sobre series OHLCV.
 *
 * Implementados a mano y sin dependencias: las librerías de TA del ecosistema
 * JS discrepan entre sí en el suavizado (sobre todo en RSI y ATR, donde unas
 * usan SMA y otras el suavizado de Wilder). Aquí se usa Wilder, que es lo que
 * usan TradingView y la mayoría de exchanges, para que los números coincidan
 * con lo que el usuario ve en su gráfico.
 *
 * Convención: toda función devuelve un array alineado con la entrada, usando
 * `null` en las posiciones donde el indicador todavía no tiene suficientes
 * datos. Así el índice i siempre corresponde a la vela i.
 */

/** Una vela: [timestamp, open, high, low, close, volume] — el formato de CCXT. */
export type Candle = [number, number, number, number, number, number];

export type Series = (number | null)[];

const OPEN = 1, HIGH = 2, LOW = 3, CLOSE = 4, VOLUME = 5;

export const closes = (c: Candle[]): number[] => c.map(k => k[CLOSE]);
export const highs = (c: Candle[]): number[] => c.map(k => k[HIGH]);
export const lows = (c: Candle[]): number[] => c.map(k => k[LOW]);
export const volumes = (c: Candle[]): number[] => c.map(k => k[VOLUME]);

/** Media móvil simple. */
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Media móvil exponencial. Se siembra con la SMA del primer bloque. */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Suavizado de Wilder (RMA) — la base de RSI y ATR. */
function wilder(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]!) / period;
    out[i] = prev;
  }
  return out;
}

/** RSI con suavizado de Wilder (el estándar de TradingView). */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  // Se descarta el índice 0 (no tiene variación) antes de suavizar.
  const avgGain = wilder(gains.slice(1), period);
  const avgLoss = wilder(losses.slice(1), period);

  for (let i = 0; i < avgGain.length; i++) {
    const g = avgGain[i], l = avgLoss[i];
    if (g === null || l === null) continue;
    // Sin pérdidas en la ventana el RSI satura en 100; evita la división por cero.
    out[i + 1] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/** MACD clásico (12, 26, 9). */
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: Series = values.map((_, i) => {
    const f = emaFast[i], s = emaSlow[i];
    return f !== null && s !== null ? f - s : null;
  });

  // La señal es una EMA de la línea MACD, que arranca más tarde que los precios.
  const firstValid = macdLine.findIndex(v => v !== null);
  const signal: Series = new Array(values.length).fill(null);
  if (firstValid !== -1) {
    const compact = macdLine.slice(firstValid) as number[];
    const sig = ema(compact, signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[firstValid + i] = sig[i];
  }

  const histogram: Series = values.map((_, i) => {
    const m = macdLine[i], s = signal[i];
    return m !== null && s !== null ? m - s : null;
  });

  return { macd: macdLine, signal, histogram };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
}

/** Bandas de Bollinger (20, 2σ). Usa desviación poblacional, como TradingView. */
export function bollinger(values: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i];
    if (mean === null) continue;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) acc += (values[j]! - mean) ** 2;
    const sd = Math.sqrt(acc / period);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { upper, middle, lower };
}

/** ATR con suavizado de Wilder. */
export function atr(candles: Candle[], period = 14): Series {
  if (candles.length < 2) return new Array(candles.length).fill(null);
  const tr: number[] = [candles[0]![HIGH] - candles[0]![LOW]];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i]![HIGH], l = candles[i]![LOW], pc = candles[i - 1]![CLOSE];
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return wilder(tr, period);
}

/**
 * VWAP acumulado desde el inicio de la serie, con precio típico (H+L+C)/3.
 *
 * Nota: el VWAP "de verdad" se reinicia cada sesión. Como una serie de velas
 * cripto no tiene sesiones, esto es el VWAP de la ventana solicitada — útil
 * para comparar contra el precio actual, pero no idéntico al VWAP diario de un
 * gráfico de acciones.
 */
export function vwap(candles: Candle[]): Series {
  const out: Series = new Array(candles.length).fill(null);
  let pv = 0, vol = 0;
  for (let i = 0; i < candles.length; i++) {
    const k = candles[i]!;
    const typical = (k[HIGH] + k[LOW] + k[CLOSE]) / 3;
    pv += typical * k[VOLUME];
    vol += k[VOLUME];
    out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}

/** Último valor no nulo de una serie. */
export function last(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return series[i]!;
  }
  return null;
}

export interface Level {
  price: number;
  /** Cuántos pivotes confluyen en este nivel. Más toques = nivel más relevante. */
  touches: number;
}

/**
 * Soportes y resistencias por pivotes fractales.
 *
 * Un pivote alto es una vela cuyo máximo supera al de las `lookback` velas a
 * cada lado. Los pivotes se agrupan en niveles cuando caen dentro de
 * `tolerancePct` entre sí, y el nivel resultante se pondera por número de toques.
 */
export function levels(candles: Candle[], lookback = 3, tolerancePct = 0.5): {
  support: Level[];
  resistance: Level[];
} {
  const hi = highs(candles), lo = lows(candles);
  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (hi[j]! >= hi[i]!) isHigh = false;
      if (lo[j]! <= lo[i]!) isLow = false;
    }
    if (isHigh) pivotHighs.push(hi[i]!);
    if (isLow) pivotLows.push(lo[i]!);
  }

  const cluster = (points: number[]): Level[] => {
    const sorted = [...points].sort((a, b) => a - b);
    const out: Level[] = [];
    for (const p of sorted) {
      const prev = out[out.length - 1];
      if (prev && Math.abs(p - prev.price) / prev.price * 100 <= tolerancePct) {
        // Media móvil del cluster: el nivel se ajusta al centro de masa.
        prev.price = (prev.price * prev.touches + p) / (prev.touches + 1);
        prev.touches++;
      } else {
        out.push({ price: p, touches: 1 });
      }
    }
    return out.sort((a, b) => b.touches - a.touches);
  };

  return { support: cluster(pivotLows), resistance: cluster(pivotHighs) };
}
