/**
 * Actividad del agente, en vivo, dentro de la pantalla de trading.
 *
 * No abre ningún canal nuevo: `useCanvasStore` ya recibe los `workEvents` por
 * WebSocket y `AppLayout` lo inicializa para toda la app, así que aquí sólo se
 * leen y se les da forma.
 *
 * Regla de diseño: cuando no hay nada ocurriendo el componente **no renderiza
 * nada**. Un hueco vacío permanente en la cabecera cuesta espacio todos los
 * días a cambio de información unos pocos segundos.
 */

import { useEffect, useMemo, useState } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { humanizeTool } from "@/modules/office3d/state/toolLabels";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Agentes cuyo trabajo tiene sentido mostrar en esta pantalla. */
const TRADING_AGENTS = new Set([
  "market_analyst",
  "risk_manager",
  "paper_trader",
  "strategy_researcher",
]);

/** Un evento terminal deja de ser "en vivo" pasado este tiempo. */
const SETTLED_LINGER_MS = 6000;

/** Reloj compartido: un único intervalo para todo el componente. */
function useNow(active: boolean, intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

export function AgentActivityStrip({ className }: { className?: string }) {
  const workEvents = useCanvasStore(s => s.workEvents);
  const graphNodes = useCanvasStore(s => s.graphNodes);

  // El último evento de un agente de trading. `workEvents` llega en orden
  // cronológico y viene acotado a 64 entradas, así que recorrerlo es barato.
  const latest = useMemo(() => {
    for (let i = workEvents.length - 1; i >= 0; i--) {
      const e = workEvents[i]!;
      if (TRADING_AGENTS.has(e.actorId)) return e;
    }
    return null;
  }, [workEvents]);

  const isRunning = latest ? latest.phase === "delegated" : false;
  const now = useNow(Boolean(latest));

  if (!latest) return null;

  const age = now - latest.timestamp;
  // Un evento ya cerrado se muestra un momento y desaparece; uno en curso se
  // queda mientras dure.
  if (!isRunning && age > SETTLED_LINGER_MS) return null;

  const agentName =
    graphNodes.find(n => n.id === latest.actorId)?.name ?? latest.actorId;

  const action = humanizeTool(latest.toolName) ?? latest.taskName;
  const seconds = Math.max(0, Math.floor(age / 1000));

  const failed = latest.phase === "failed" || latest.phase === "aborted" || latest.phase === "blocked";
  const done = latest.phase === "completed" || latest.phase === "review_passed";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px]",
        isRunning && "border-amber-500/40 bg-amber-500/[0.07] text-amber-600 dark:text-amber-400",
        done && "border-emerald-500/40 bg-emerald-500/[0.07] text-emerald-600 dark:text-emerald-400",
        failed && "border-red-500/40 bg-red-500/[0.07] text-red-600 dark:text-red-400",
        className
      )}
      // Un lector de pantalla no debe recibir un anuncio por segundo: sólo
      // interesa el cambio de estado, no el contador.
      role="status"
      aria-live="polite"
    >
      {isRunning ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
      ) : failed ? (
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
      )}

      <span className="font-medium">{agentName}</span>
      <span className="text-muted-foreground">·</span>
      <span className="truncate max-w-[22ch]" title={action}>{action}</span>

      {isRunning && seconds > 0 && (
        <span className="tabular-nums text-muted-foreground">{seconds}s</span>
      )}
    </div>
  );
}
