/**
 * Por dónde suena la voz de la colmena.
 *
 * Hay dos caminos porque los motores no coinciden:
 *
 * - Chrome —la app web, y el webview de Windows— implementa
 *   `AudioContext.setSinkId()` y devuelve las salidas en `enumerateDevices()`.
 *   Todo se resuelve dentro de la página.
 * - WebKitGTK —la app de escritorio en Linux— no implementa ninguna de las dos.
 *   Medido sobre 2.52.5: `setSinkId` es `undefined` y `enumerateDevices()`
 *   devuelve cero dispositivos `audiooutput` incluso con permiso de micrófono
 *   concedido, aunque sí liste los de entrada. Ahí la lista y el cambio los
 *   hace el proceso nativo preguntándole al sistema.
 *
 * En ambos casos los dispositivos salen del sistema operativo: no hay ninguna
 * lista escrita a mano.
 */

import { isDesktopApp } from "@/stores/useDesktopUpdateStore";

export interface SalidaAudio {
  id: string;
  nombre: string;
  porDefecto: boolean;
}

type ContextoConSalida = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/** ¿El motor deja elegir la salida desde la propia página? */
export function salidaPorNavegador(): boolean {
  return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
}

/** Salidas que ofrece el sistema, por la vía que corresponda. */
export async function listarSalidas(): Promise<SalidaAudio[]> {
  if (salidaPorNavegador()) {
    try {
      const dispositivos = await navigator.mediaDevices.enumerateDevices();
      return dispositivos
        .filter((d) => d.kind === "audiooutput")
        .map((d, i) => ({
          id: d.deviceId,
          // Sin permiso de micrófono el navegador oculta las etiquetas.
          nombre: d.label || `Salida ${i + 1}`,
          porDefecto: d.deviceId === "default",
        }));
    } catch {
      return [];
    }
  }
  if (!isDesktopApp()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<SalidaAudio[]>("audio_outputs");
  } catch {
    return [];
  }
}

/**
 * Manda la voz al dispositivo elegido.
 *
 * En la vía nativa mueve sólo el flujo de esta aplicación; la salida por
 * defecto del sistema no se toca, para no reencaminar lo que suene aparte.
 */
export async function aplicarSalida(id: string, context: AudioContext | null): Promise<void> {
  if (salidaPorNavegador()) {
    const ctx = context as ContextoConSalida | null;
    if (ctx?.setSinkId) await ctx.setSinkId(id);
    return;
  }
  if (!isDesktopApp()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_audio_output", { id });
}
