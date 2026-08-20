/**
 * Enjambre de trabajo: los especialistas ejecutando en segundo plano.
 *
 * Aparece sólo mientras hay trabajo delegado vivo, así que su presencia es
 * información, no adorno: si hay luces orbitando, la colmena está ocupada.
 * Instanced para que doce cuerpos cuesten una sola llamada de dibujo.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, InstancedMesh, MathUtils, Object3D } from "three";
import type { PulseRef } from "./audioPulse";

const COUNT = 12;

interface WorkSwarmProps {
  working: boolean;
  pulse: PulseRef;
}

export function WorkSwarm({ working, pulse }: WorkSwarmProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const presencia = useRef(0);

  const orbitas = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        radio: 1.5 + (i % 4) * 0.45,
        alto: -0.6 + ((i * 7) % 11) * 0.16,
        velocidad: 0.28 + ((i * 13) % 7) * 0.055,
        fase: (i / COUNT) * Math.PI * 2,
      })),
    [],
  );

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);

    // Entrada y salida suaves: que aparezcan de golpe se leería como un glitch.
    presencia.current = MathUtils.damp(presencia.current, working ? 1 : 0, 2.4, dt);
    mesh.visible = presencia.current > 0.01;
    if (!mesh.visible) return;

    const empuje = pulse.current.voice * 0.35;

    for (let i = 0; i < COUNT; i++) {
      const o = orbitas[i]!;
      const angulo = o.fase + t * o.velocidad;
      const radio = o.radio * (0.6 + presencia.current * 0.4) + empuje;
      dummy.position.set(
        Math.cos(angulo) * radio,
        o.alto + Math.sin(t * 0.9 + o.fase) * 0.18,
        Math.sin(angulo) * radio * 0.75,
      );
      const escala = (0.035 + ((i % 3) * 0.012)) * presencia.current;
      dummy.scale.setScalar(escala);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;

    const mat = mesh.material as { opacity: number };
    mat.opacity = presencia.current * 0.9;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial
        color={new Color("#7a5ff1")}
        transparent
        opacity={0}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
