/** Formateo compartido por los paneles de trading. Español (Colombia). */

export const fmtMoney = (v: number, quote = "USDT") =>
  `${v.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${quote}`;

export const fmtPrice = (v: number) => {
  const abs = Math.abs(v);
  const d = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return v.toLocaleString("es", { maximumFractionDigits: d });
};

export const fmtPct = (v: number, digits = 2) =>
  `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;

export const fmtAmount = (v: number) =>
  v.toLocaleString("es", { maximumFractionDigits: 8 });

export const fmtCompact = (v: number) => {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(2);
};

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("es", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });

/** Clase de color por signo. Neutro en cero para no teñir un valor sin dirección. */
export const signClass = (v: number) =>
  v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "text-muted-foreground";
