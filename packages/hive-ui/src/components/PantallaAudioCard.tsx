/**
 * Ajustes de pantalla y audio.
 *
 * Estaban repartidos donde no se encontraban: la salida de audio vivía dentro
 * del panel plegable de la consola de voz, y el zoom no existía. Los dos son
 * ajustes de la aplicación entera, así que su sitio es Ajustes.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus, RotateCcw, Volume2, ZoomIn } from "lucide-react";
import { aplicarZoom, cargarZoom, zoomDisponible, ZOOM_MAX, ZOOM_MIN, ZOOM_PASO } from "@/lib/desktop-zoom";
import { listarSalidas, salidaPorNavegador, type SalidaAudio } from "@/lib/realtime/salidas";
import { loadVoicePrefs, useRealtimeStore } from "@/stores/realtimeStore";

export function PantallaAudioCard() {
  const usarSalida = useRealtimeStore((s) => s.usarSalida);
  const [zoom, setZoom] = useState(() => cargarZoom());
  const [salidas, setSalidas] = useState<SalidaAudio[]>([]);
  const [salida, setSalida] = useState(() => loadVoicePrefs().output);
  const conZoom = zoomDisponible();

  // Los atajos de teclado cambian el zoom desde fuera de este panel.
  useEffect(() => {
    const oir = (e: Event) => setZoom((e as CustomEvent<number>).detail);
    window.addEventListener("hive-zoom", oir);
    return () => window.removeEventListener("hive-zoom", oir);
  }, []);

  useEffect(() => {
    let vivo = true;
    const cargar = () => void listarSalidas().then((lista) => { if (vivo) setSalidas(lista); });
    cargar();
    navigator.mediaDevices?.addEventListener?.("devicechange", cargar);
    return () => {
      vivo = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", cargar);
    };
  }, []);

  const cambiarZoom = (valor: number) => void aplicarZoom(valor).then(setZoom);

  return (
    <div className="space-y-6">
      {conZoom && (
        <div className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-5">
          <div className="flex items-center gap-2">
            <ZoomIn className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium">Tamaño de la vista</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Escala toda la aplicación. También con <kbd>Ctrl</kbd> y <kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd>,
            o <kbd>Ctrl</kbd> y la rueda del ratón.
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline" size="icon" aria-label="Reducir"
              disabled={zoom <= ZOOM_MIN}
              onClick={() => cambiarZoom(zoom - ZOOM_PASO)}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="min-w-16 text-center font-mono text-sm tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="outline" size="icon" aria-label="Ampliar"
              disabled={zoom >= ZOOM_MAX}
              onClick={() => cambiarZoom(zoom + ZOOM_PASO)}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => cambiarZoom(1)}>
              <RotateCcw className="h-3.5 w-3.5" /> Restablecer
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-5">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Salida de la voz en vivo</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Por dónde se oye a la colmena en HiveLive. La lista la reporta el sistema
          operativo y se actualiza al conectar o desconectar un aparato.
        </p>
        {salidas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {salidaPorNavegador()
              ? "El navegador no expone ninguna salida. Concede el permiso de micrófono y vuelve a abrir esta pantalla."
              : "No se detectó ninguna salida de audio."}
          </p>
        ) : (
          <select
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={salida}
            onChange={(e) => {
              setSalida(e.target.value);
              void usarSalida(e.target.value);
            }}
          >
            <option value="">Predeterminada del sistema</option>
            {salidas
              .filter((s) => s.id !== "default")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                  {s.porDefecto ? " (actual del sistema)" : ""}
                </option>
              ))}
          </select>
        )}
      </div>
    </div>
  );
}
