/**
 * Captura y reproducción de audio para el modo de voz en tiempo real.
 *
 * La API Live habla PCM16 mono crudo: 16 kHz hacia el modelo, 24 kHz de vuelta.
 * `MediaRecorder` no sirve — produce contenedores webm/ogg— así que la captura
 * va por AudioWorklet.
 *
 * El worklet se carga desde un Blob URL en vez de un archivo aparte: así funciona
 * igual en dev, en el build de Vite y dentro del bundle embebido en el binario,
 * sin que ninguno de los tres tenga que saber que existe un asset extra.
 */

import { aplicarSalida } from "@/lib/realtime/salidas";

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;

/** Bloques de ~40 ms: suficientemente chicos para que el VAD reaccione rápido. */
const FRAME_SAMPLES = 640;

const WORKLET_SOURCE = `
class PCMCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = options.processorOptions.targetRate;
    this.frame = options.processorOptions.frameSamples;
    this.ratio = sampleRate / this.target;
    this.acc = [];
    this.pos = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    // Remuestreo lineal al vuelo: el navegador no siempre concede el sampleRate
    // pedido (WebKitGTK, por ejemplo, entrega el del dispositivo).
    while (this.pos < input.length) {
      const idx = Math.floor(this.pos);
      const frac = this.pos - idx;
      const a = input[idx];
      const b = idx + 1 < input.length ? input[idx + 1] : a;
      this.acc.push(a + (b - a) * frac);
      this.pos += this.ratio;

      if (this.acc.length >= this.frame) {
        const pcm = new Int16Array(this.acc.length);
        for (let i = 0; i < this.acc.length; i++) {
          const s = Math.max(-1, Math.min(1, this.acc[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this.acc = [];
      }
    }
    this.pos -= input.length;
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
`;

/** Bins de espectro que se publican al visualizador. */
export const SPECTRUM_BINS = 128;

/**
 * Lectura de espectro compartida por micrófono y reproducción. El visualizador
 * la sube tal cual como fila de una textura, así que se entrega ya normalizada
 * a 0–255 y con un suavizado temporal: sin él, el shader tiembla a 60 fps.
 */
export class SpectrumTap {
  readonly bins = new Uint8Array(SPECTRUM_BINS);
  private analyser: AnalyserNode | null = null;
  private raw: Uint8Array<ArrayBuffer> | null = null;
  private smoothedLevel = 0;

  attach(context: AudioContext, source: AudioNode): AnalyserNode {
    const analyser = context.createAnalyser();
    analyser.fftSize = SPECTRUM_BINS * 4;
    analyser.smoothingTimeConstant = 0.72;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -12;
    source.connect(analyser);
    this.analyser = analyser;
    this.raw = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    return analyser;
  }

  /** Refresca `bins` y devuelve el nivel general (0–1). */
  sample(): number {
    if (!this.analyser || !this.raw) return 0;
    this.analyser.getByteFrequencyData(this.raw);

    // La voz vive en la mitad baja del espectro: comprimirla ahí da mucho más
    // detalle visible que repartir los bins linealmente hasta Nyquist.
    const usable = Math.floor(this.raw.length * 0.62);
    let sum = 0;
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const t = i / (SPECTRUM_BINS - 1);
      const src = Math.min(usable - 1, Math.round(Math.pow(t, 1.6) * (usable - 1)));
      const value = this.raw[src] ?? 0;
      this.bins[i] = value;
      sum += value;
    }

    /**
     * Ganancia medida, no elegida a ojo.
     *
     * La voz real de la Live API mide 0.12 de media y 0.31 en los picos con este
     * mismo cálculo (comprobado sobre 22 s de audio del modelo). Devolver eso en
     * crudo dejaba a quien lo consuma escalando gestos sobre un rango de 0–0.3:
     * las manos se movían dos grados y parecía que no se movieran. Con 3.2× los
     * picos llegan a 1 y el rango útil se aprovecha entero.
     */
    const level = Math.min(1, (sum / (SPECTRUM_BINS * 255)) * 3.2);
    // Ataque rápido, caída lenta: la energía sube con la sílaba y decae suave.
    this.smoothedLevel = level > this.smoothedLevel
      ? this.smoothedLevel + (level - this.smoothedLevel) * 0.55
      : this.smoothedLevel + (level - this.smoothedLevel) * 0.12;
    return this.smoothedLevel;
  }

  detach(): void {
    try {
      this.analyser?.disconnect();
    } catch {
      /* el contexto ya se cerró */
    }
    this.analyser = null;
    this.raw = null;
    this.bins.fill(0);
    this.smoothedLevel = 0;
  }
}

export class RealtimeMic {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  /** Espectro de lo que entra por el micrófono. */
  readonly spectrum = new SpectrumTap();

  /** @param onFrame recibe PCM16 mono a INPUT_SAMPLE_RATE. */
  constructor(private readonly onFrame: (pcm: ArrayBuffer) => void) {}

  async start(): Promise<void> {
    // Sin cancelación de eco el micrófono se oye a sí mismo por el altavoz y el
    // modelo se interrumpe solo a mitad de frase.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    this.context = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      await this.context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    this.node = new AudioWorkletNode(this.context, "pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { targetRate: INPUT_SAMPLE_RATE, frameSamples: FRAME_SAMPLES },
    });
    this.node.port.onmessage = (event) => this.onFrame(event.data as ArrayBuffer);

    this.source = this.context.createMediaStreamSource(this.stream);
    this.source.connect(this.node);
    this.spectrum.attach(this.context, this.source);

    // Mismo motivo que en RealtimePlayer: si el contexto no está corriendo, el
    // worklet no procesa y no se envía ni un byte de voz. Sin esperar, por el
    // mismo riesgo de promesa que no resuelve.
    if (this.context.state !== "running") void this.context.resume().catch(() => {});
  }

  stop(): void {
    this.spectrum.detach();
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close();
    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
  }
}

export class RealtimePlayer {
  private context: AudioContext | null = null;
  /** Momento en que termina lo ya encolado: los bloques se pegan sin huecos. */
  private nextStartAt = 0;
  private playing = new Set<AudioBufferSourceNode>();
  /** Bus intermedio: todo pasa por acá para poder medir lo que suena. */
  private bus: GainNode | null = null;

  /** Espectro de la voz del modelo. */
  readonly spectrum = new SpectrumTap();

  /** Llamado cuando la cola se vacía (el modelo dejó de hablar). */
  onIdle?: () => void;

  /** Salida elegida por el usuario; null = la que decida el sistema. */
  private salidaId: string | null = null;
  private salidaLista = false;
  private aplicandoSalida = false;

  async resume(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.bus = this.context.createGain();
      this.bus.connect(this.context.destination);
      this.spectrum.attach(this.context, this.bus);
      // WebKit (el motor de la app de escritorio en Linux) tiene un tercer
      // estado además de "running" y "suspended": "interrupted". Un contexto
      // creado fuera del gesto del usuario nace ahí, y también cae ahí si el
      // sistema le quita la sesión de audio en marcha —un auricular Bluetooth
      // que cambia de modo, otra aplicación que toma la salida—. El reloj
      // sigue avanzando, así que nada parece roto, pero no sale sonido: se oye
      // al usuario y no se oye a la colmena. Reanudar en cada cambio de estado
      // lo recupera solo.
      this.context.addEventListener("statechange", () => this.despertar());
    }
    // Medido en WebKit: resume() sobre un contexto "interrupted" devuelve una
    // promesa que no se resuelve NUNCA. Esperarla aquí colgaría el arranque de
    // la llamada entera —ni siquiera llegaría a abrirse el micrófono—, así que
    // solo se espera en el caso normal y el resto se intenta sin bloquear.
    if (this.context.state === "suspended") await this.context.resume();
    else this.despertar();
  }

  /** Intenta levantar el contexto sin hacer esperar a quien llama. */
  private despertar(): void {
    const context = this.context;
    if (!context || context.state === "running" || context.state === "closed") return;
    void context.resume().catch(() => {});
  }

  /** Cambia el dispositivo por el que sale la voz. */
  async usarSalida(id: string | null): Promise<void> {
    this.salidaId = id;
    this.salidaLista = false;
    await this.encaminar();
  }

  /**
   * Aplica la salida elegida, si hace falta.
   *
   * En Linux el flujo de audio sólo existe mientras se está reproduciendo algo,
   * así que el primer intento —al abrir la llamada— puede no encontrar nada que
   * mover; por eso se reintenta al llegar el primer bloque de voz.
   */
  private async encaminar(): Promise<void> {
    if (!this.salidaId || this.salidaLista || this.aplicandoSalida) return;
    this.aplicandoSalida = true;
    try {
      await aplicarSalida(this.salidaId, this.context);
      this.salidaLista = true;
    } catch {
      // Todavía no hay nada sonando: se reintenta con el siguiente bloque.
    } finally {
      this.aplicandoSalida = false;
    }
  }

  enqueue(pcm: ArrayBuffer): void {
    if (!this.context || !this.bus) return;
    void this.encaminar();
    const samples = new Int16Array(pcm);
    if (!samples.length) return;

    const buffer = this.context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 0x8000;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.bus);

    const now = this.context.currentTime;
    // Un pelo de margen evita cortes cuando la red entrega los bloques justos.
    const startAt = Math.max(now + 0.02, this.nextStartAt);
    source.start(startAt);
    this.nextStartAt = startAt + buffer.duration;

    this.playing.add(source);
    source.onended = () => {
      this.playing.delete(source);
      if (!this.playing.size) this.onIdle?.();
    };
  }

  /** Barge-in: el usuario habló encima. Todo lo pendiente se descarta. */
  interrupt(): void {
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        /* ya había terminado */
      }
    }
    this.playing.clear();
    this.nextStartAt = 0;
  }

  get isSpeaking(): boolean {
    return this.playing.size > 0;
  }

  stop(): void {
    this.interrupt();
    this.spectrum.detach();
    try {
      this.bus?.disconnect();
    } catch {
      /* el contexto ya se cerró */
    }
    this.bus = null;
    void this.context?.close();
    this.context = null;
  }
}

/** Traduce el fallo de getUserMedia a algo accionable (mismo criterio que ChatInput). */
export function describeMicError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Permiso de micrófono denegado. Habilítalo para este sitio y vuelve a intentar.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No se encontró ningún micrófono conectado.";
    case "NotReadableError":
      return "Otra aplicación está usando el micrófono.";
    default:
      return `No se pudo acceder al micrófono: ${(error as Error)?.message ?? "error desconocido"}`;
  }
}
