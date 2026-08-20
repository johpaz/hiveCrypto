/**
 * Paralaje de cámara.
 *
 * El relieve de BIA sólo se percibe si el punto de vista se mueve: con la
 * cámara clavada, un bajorrelieve se ve idéntico a una foto plana. La deriva
 * automática garantiza que el volumen se lea aunque nadie toque el mouse, y el
 * seguimiento del puntero da la sensación de estar frente a alguien.
 */

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MathUtils, Vector3 } from "three";

const OBJETIVO = new Vector3(0, 0.05, 0);

interface ParallaxRigProps {
  /** Amplitud del desplazamiento lateral, en unidades de escena. */
  amplitud?: number;
  /**
   * Se apaga cuando el usuario toma el control de la cámara: si ambos escriben
   * la posición, la escena "tira" de vuelta en cada fotograma y los controles
   * parecen rotos.
   */
  enabled?: boolean;
}

export function ParallaxRig({ amplitud = 0.16, enabled = true }: ParallaxRigProps) {
  const camara = useThree((s) => s.camera);
  const puntero = useRef({ x: 0, y: 0 });
  const base = useRef(camara.position.clone());

  useEffect(() => {
    const mover = (e: PointerEvent) => {
      // Normalizado a −1..1 respecto al centro de la ventana.
      puntero.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      puntero.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", mover);
    return () => window.removeEventListener("pointermove", mover);
  }, []);

  useFrame((state, delta) => {
    if (!enabled) return;
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Deriva propia + puntero. Aunque el usuario no mueva el mouse, la escena
    // respira y el relieve se nota.
    const derivaX = reduce ? 0 : Math.sin(t * 0.18) * 0.35;
    const derivaY = reduce ? 0 : Math.cos(t * 0.13) * 0.18;

    const destinoX = base.current.x + (puntero.current.x * 0.6 + derivaX) * amplitud;
    const destinoY = base.current.y - (puntero.current.y * 0.35 + derivaY) * amplitud * 0.5;

    camara.position.x = MathUtils.damp(camara.position.x, destinoX, 2.2, dt);
    camara.position.y = MathUtils.damp(camara.position.y, destinoY, 2.2, dt);
    camara.lookAt(OBJETIVO);
  });

  return null;
}
