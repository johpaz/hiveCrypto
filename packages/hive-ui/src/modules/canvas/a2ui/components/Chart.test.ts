import { describe, it, expect } from "vitest";
import { toCandles, toSeries, MAX_CANDLES } from "./Chart";

const candle = (i: number) => [i, 1, 2, 0.5, 1.5, 100];

describe("Chart — coerción de velas", () => {
  it("acepta velas OHLCV bien formadas", () => {
    expect(toCandles([candle(1), candle(2)])).toHaveLength(2);
  });

  it("descarta filas que no son arrays o están incompletas", () => {
    // El modelo de datos lo escribe un LLM: puede llegar cualquier cosa.
    expect(toCandles([candle(1), "no", null, [1, 2, 3], {}, candle(2)])).toHaveLength(2);
  });

  it("descarta filas con valores no numéricos o no finitos", () => {
    expect(toCandles([[1, 2, 3, 4, "x", 6]])).toHaveLength(0);
    expect(toCandles([[1, 2, 3, 4, NaN, 6]])).toHaveLength(0);
    expect(toCandles([[1, 2, 3, 4, Infinity, 6]])).toHaveLength(0);
  });

  it("recorta al máximo conservando lo más reciente", () => {
    const many = Array.from({ length: MAX_CANDLES + 50 }, (_, i) => candle(i));
    const out = toCandles(many);
    expect(out).toHaveLength(MAX_CANDLES);
    // El último timestamp debe seguir siendo el más nuevo.
    expect(out[out.length - 1]![0]).toBe(MAX_CANDLES + 49);
  });

  it("devuelve vacío ante entradas que no son array", () => {
    expect(toCandles(undefined)).toEqual([]);
    expect(toCandles("BTC")).toEqual([]);
    expect(toCandles({ candles: [] })).toEqual([]);
  });
});

describe("Chart — coerción de series", () => {
  it("convierte huecos en null en vez de descartarlos", () => {
    // Alinear con las velas importa: descartar desplazaría el indicador.
    expect(toSeries([1, null, "x", 4])).toEqual([1, null, null, 4]);
  });

  it("devuelve undefined si no hay serie", () => {
    expect(toSeries(undefined)).toBeUndefined();
    expect(toSeries(42)).toBeUndefined();
  });
});
