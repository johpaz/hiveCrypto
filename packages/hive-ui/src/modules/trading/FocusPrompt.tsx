/**
 * Aviso de que el agente está mirando otro símbolo.
 *
 * Decisión deliberada: **el agente no secuestra la pantalla**. Si cambiara el
 * par bajo el cursor, el botón de comprar quedaría apuntando a otro activo del
 * que el usuario cree — en trading eso no es sólo desorientador, es peligroso.
 *
 * Por eso el foco se ofrece y no se impone, con una excepción razonable: si el
 * usuario no ha tocado la pantalla en un rato, seguir al agente es justo lo que
 * espera y pedirle un clic sobra.
 */

import { useEffect, useRef, useState } from "react";
import { useCanvasStore, type TradingFocus } from "@/stores/canvasStore";
import { Button } from "@/components/ui/button";
import { Eye, X } from "lucide-react";
import { fmtPrice } from "./format";

/** Sin interacción durante este tiempo, seguir al agente deja de ser intrusivo. */
const IDLE_AUTO_FOLLOW_MS = 20_000;

interface Props {
  /** Símbolo que se está mostrando ahora. */
  currentSymbol: string;
  onFollow: (focus: TradingFocus) => void;
}

export function FocusPrompt({ currentSymbol, onFollow }: Props) {
  const focus = useCanvasStore(s => s.tradingFocus);
  const clearFocus = useCanvasStore(s => s.clearTradingFocus);
  const [dismissed, setDismissed] = useState<number | null>(null);

  // Marca de la última interacción del usuario con la pantalla.
  const lastInteraction = useRef(Date.now());
  useEffect(() => {
    const touch = () => { lastInteraction.current = Date.now(); };
    const events = ["pointerdown", "keydown", "wheel"] as const;
    events.forEach(e => window.addEventListener(e, touch, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, touch));
  }, []);

  const sameSymbol = focus?.symbol === currentSymbol;
  const alreadyDismissed = focus ? dismissed === focus.ts : false;

  // Auto-seguir sólo si el usuario está inactivo. Se evalúa al llegar el foco,
  // no en un intervalo: si estaba escribiendo hace dos segundos, no se mueve.
  useEffect(() => {
    if (!focus || sameSymbol || alreadyDismissed) return;
    if (Date.now() - lastInteraction.current > IDLE_AUTO_FOLLOW_MS) {
      onFollow(focus);
      clearFocus();
    }
  }, [focus, sameSymbol, alreadyDismissed, onFollow, clearFocus]);

  // Si el agente enfoca lo que ya se ve, no hay nada que ofrecer; los niveles
  // igual se aplican para que aparezcan marcados.
  useEffect(() => {
    if (focus && sameSymbol) {
      onFollow(focus);
      clearFocus();
    }
  }, [focus, sameSymbol, onFollow, clearFocus]);

  if (!focus || sameSymbol || alreadyDismissed) return null;

  const levels = [
    focus.support !== undefined ? `soporte ${fmtPrice(focus.support)}` : null,
    focus.resistance !== undefined ? `resistencia ${fmtPrice(focus.resistance)}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div
      className="flex items-start gap-2.5 rounded-md border border-amber-500/35 bg-amber-500/[0.07] px-3 py-2 text-xs"
      role="status"
    >
      <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <span className="text-amber-700 dark:text-amber-400">
          El agente está viendo <strong>{focus.symbol}</strong>
          {focus.timeframe ? ` en ${focus.timeframe}` : ""}
        </span>
        {focus.note && (
          <div className="mt-0.5 text-muted-foreground">{focus.note}</div>
        )}
        {levels && (
          <div className="mt-0.5 tabular-nums text-muted-foreground">{levels}</div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => { onFollow(focus); clearFocus(); }}
        >
          Seguir
        </Button>
        <Button
          size="icon" variant="ghost" className="h-6 w-6"
          onClick={() => setDismissed(focus.ts)}
          aria-label="Descartar"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
