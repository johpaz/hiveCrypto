import { describe, expect, it } from "bun:test";
import { sma, ema, rsi, macd, bollinger, atr, vwap, last, levels, type Candle } from "../src/indicators.ts";

/**
 * Serie de referencia canónica de Wilder (la que publican StockCharts y el
 * libro original). Los valores esperados de RSI(14) para estos cierres están
 * documentados: 70.53, 66.32, 66.55 en los índices 14, 15 y 16.
 */
const WILDER_CLOSES = [
  44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245,
  45.8433, 46.0826, 45.8931, 46.0328, 45.6140, 46.2820, 46.2820, 46.0028,
  46.0328, 46.4116, 46.2222, 45.6439,
];

const candle = (h: number, l: number, c: number, v = 1, ts = 0): Candle => [ts, c, h, l, c, v];

describe("sma", () => {
  it("promedia la ventana y deja null antes de tener datos", () => {
    const s = sma([1, 2, 3, 4, 5], 3);
    expect(s[0]).toBeNull();
    expect(s[1]).toBeNull();
    expect(s[2]).toBe(2);   // (1+2+3)/3
    expect(s[3]).toBe(3);
    expect(s[4]).toBe(4);
  });

  it("devuelve todo null si no hay suficientes datos", () => {
    expect(sma([1, 2], 5).every(v => v === null)).toBe(true);
  });
});

describe("ema", () => {
  it("se siembra con la SMA del primer bloque", () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[2]).toBe(2); // igual a la SMA inicial
    // k = 2/(3+1) = 0.5 → 4*0.5 + 2*0.5 = 3
    expect(e[3]).toBeCloseTo(3, 10);
  });

  it("reacciona más rápido que la SMA ante un salto", () => {
    const values = [10, 10, 10, 10, 10, 20];
    expect(last(ema(values, 5))!).toBeGreaterThan(last(sma(values, 5))!);
  });
});

describe("rsi", () => {
  it("coincide con los valores publicados de la serie de Wilder", () => {
    const r = rsi(WILDER_CLOSES, 14);
    // El primer RSI computable cae en el índice 14 (necesita 14 variaciones).
    expect(r.slice(0, 14).every(v => v === null)).toBe(true);
    expect(r[14]!).toBeCloseTo(70.53, 2);
    expect(r[15]!).toBeCloseTo(66.32, 2);
    expect(r[16]!).toBeCloseTo(66.55, 2);
  });

  it("satura en 100 cuando sólo hay subidas", () => {
    const onlyUp = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(last(rsi(onlyUp, 14))).toBe(100);
  });

  it("tiende a 0 cuando sólo hay bajadas", () => {
    const onlyDown = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(last(rsi(onlyDown, 14))!).toBeCloseTo(0, 5);
  });

  it("queda entre 0 y 100 siempre", () => {
    const noisy = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i) * 10 + i * 0.3);
    for (const v of rsi(noisy, 14)) {
      if (v === null) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe("macd", () => {
  it("histograma = macd - signal", () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const m = macd(values);
    for (let i = 0; i < values.length; i++) {
      if (m.macd[i] === null || m.signal[i] === null) continue;
      expect(m.histogram[i]!).toBeCloseTo(m.macd[i]! - m.signal[i]!, 10);
    }
  });

  it("la señal arranca después de la línea macd", () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 + i);
    const m = macd(values);
    const firstMacd = m.macd.findIndex(v => v !== null);
    const firstSignal = m.signal.findIndex(v => v !== null);
    expect(firstSignal).toBeGreaterThan(firstMacd);
  });
});

describe("bollinger", () => {
  it("las bandas encierran a la media y son simétricas", () => {
    const values = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 5);
    const b = bollinger(values, 20, 2);
    const i = 49;
    expect(b.upper[i]!).toBeGreaterThan(b.middle[i]!);
    expect(b.lower[i]!).toBeLessThan(b.middle[i]!);
    expect(b.upper[i]! - b.middle[i]!).toBeCloseTo(b.middle[i]! - b.lower[i]!, 10);
  });

  it("con precio constante las bandas colapsan sobre la media", () => {
    const b = bollinger(new Array(30).fill(100), 20, 2);
    expect(b.upper[29]).toBeCloseTo(100, 10);
    expect(b.lower[29]).toBeCloseTo(100, 10);
  });
});

describe("atr", () => {
  it("mide el rango verdadero incluyendo gaps", () => {
    // Gap alcista: el cierre previo queda por debajo del mínimo actual, así que
    // el rango verdadero es mayor que high-low.
    const candles: Candle[] = [
      candle(10, 9, 9.5), candle(20, 19, 19.5),
      ...Array.from({ length: 20 }, () => candle(20, 19, 19.5)),
    ];
    const a = atr(candles, 14);
    expect(last(a)!).toBeGreaterThan(0);
  });
});

describe("vwap", () => {
  it("con precio constante devuelve ese precio", () => {
    const candles: Candle[] = Array.from({ length: 10 }, () => candle(100, 100, 100, 5));
    expect(last(vwap(candles))).toBeCloseTo(100, 10);
  });

  it("pondera por volumen, no por número de velas", () => {
    const candles: Candle[] = [
      candle(100, 100, 100, 1),
      candle(200, 200, 200, 99),
    ];
    // Casi todo el volumen está en 200, así que el VWAP debe acercarse a 200.
    expect(last(vwap(candles))!).toBeGreaterThan(190);
  });
});

describe("levels", () => {
  it("detecta un máximo pivote como resistencia", () => {
    const flat = Array.from({ length: 10 }, () => candle(100, 99, 99.5));
    const peak = candle(120, 119, 119.5);
    const candles: Candle[] = [...flat, peak, ...flat];
    const { resistance } = levels(candles, 3);
    expect(resistance.some(r => Math.abs(r.price - 120) < 0.01)).toBe(true);
  });

  it("agrupa pivotes cercanos y cuenta los toques", () => {
    const flat = () => Array.from({ length: 5 }, () => candle(100, 99, 99.5));
    const peakA = candle(120.0, 119, 119.5);
    const peakB = candle(120.2, 119, 119.5); // dentro de la tolerancia del 0.5%
    const candles: Candle[] = [...flat(), peakA, ...flat(), peakB, ...flat()];
    const { resistance } = levels(candles, 3, 0.5);
    const cluster = resistance.find(r => Math.abs(r.price - 120.1) < 0.5);
    expect(cluster?.touches).toBe(2);
  });
});
