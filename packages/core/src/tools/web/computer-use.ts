/**
 * computer_use_task — Hive opera su propio navegador mirando la pantalla.
 *
 * @category web
 * @seedId computer_use_task
 * @spanish usar el navegador, hacer clic, operar una página, rellenar un formulario
 *
 * A diferencia del resto de `browser_*`, que actúan por selector CSS, aquí el
 * modelo ve una captura y decide dónde pulsar. Sirve para páginas donde no hay
 * selector estable: canvas, lienzos, interfaces generadas, PDFs incrustados.
 *
 * El bucle es el estándar de Computer Use: captura → el modelo devuelve una
 * acción con coordenadas → se ejecuta → nueva captura, hasta terminar.
 *
 * Dos decisiones que conviene conocer:
 *
 * 1. **Las acciones se ejecutan con `evaluate()`, no con CDP.** `evaluate` está
 *    en la interfaz común de los dos backends, así que esto funciona también
 *    con agent-browser headless — que es el que corre en un servidor. Atarlo a
 *    CDP lo habría dejado utilizable sólo con WebView y entorno gráfico.
 *
 * 2. **Actúa sobre el navegador de Hive, nunca sobre la pantalla del usuario.**
 *    Si se equivoca, rompe su propia pestaña. En Wayland, además, ninguna
 *    aplicación puede mover el ratón de otras ventanas.
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService } from "./browser-service.ts";
import { loadProviderApiKey } from "../../storage/crypto.ts";

const log = logger.child("computer-use");

/** Resolución recomendada por Google para este modelo. */
const VIEWPORT = { width: 1440, height: 900 };
/** Tope de acciones por tarea: un bucle mal cerrado no puede girar sin fin. */
const MAX_PASOS = 15;
/** El modelo devuelve coordenadas en 0–999; hay que escalarlas al viewport. */
const ESCALA_MODELO = 1000;

const MODELO = process.env.HIVE_COMPUTER_USE_MODEL || "gemini-3.7-flash";

interface Vista {
  url: string;
  navigate(url: string): Promise<void>;
  evaluate<T = unknown>(script: string): Promise<T>;
  screenshot(options?: Record<string, unknown>): Promise<string>;
  type(text: string): Promise<void>;
  press(key: string, options?: { modifiers?: string[] }): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  resize(width: number, height: number): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
}

/** Escala una coordenada del espacio del modelo (0–999) al viewport real. */
function aPixeles(valor: unknown, tamano: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n / ESCALA_MODELO) * tamano);
}

/**
 * Clic por coordenadas.
 *
 * Se despacha la secuencia completa (mousedown, mouseup, click) sobre el
 * elemento que hay en el punto: llamar sólo a `.click()` se salta los handlers
 * que muchas interfaces cuelgan de mousedown, y el clic parece no hacer nada.
 */
function guionClic(x: number, y: number, boton: number, veces: number): string {
  return `(() => {
    const el = document.elementFromPoint(${x}, ${y});
    if (!el) return "sin-elemento";
    const opts = { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y}, button: ${boton} };
    for (let i = 0; i < ${veces}; i++) {
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    }
    if (typeof el.focus === "function") el.focus();
    return (el.tagName || "?") + " " + ((el.innerText || el.value || "").trim().slice(0, 60));
  })()`;
}

function guionHover(x: number, y: number): string {
  return `(() => {
    const el = document.elementFromPoint(${x}, ${y});
    if (!el) return "sin-elemento";
    const opts = { bubbles: true, clientX: ${x}, clientY: ${y} };
    el.dispatchEvent(new MouseEvent("mouseover", opts));
    el.dispatchEvent(new MouseEvent("mousemove", opts));
    return el.tagName || "?";
  })()`;
}

/**
 * Ejecuta una acción del modelo.
 *
 * El nombre se compara por palabra clave y no contra una lista cerrada: los
 * nombres de las funciones predefinidas cambian entre versiones del modelo
 * (`click` vs `click_at`, `press_key` vs `key_combination`), y una tabla exacta
 * se rompería en la siguiente.
 */
async function ejecutarAccion(
  vista: Vista,
  nombre: string,
  args: Record<string, unknown>,
  viewport: { width: number; height: number },
): Promise<string> {
  const n = nombre.toLowerCase();
  const x = aPixeles(args.x, viewport.width);
  const y = aPixeles(args.y, viewport.height);

  if (n.includes("navigate") || n.includes("go_to") || n === "search") {
    const destino = String(args.url ?? args.query ?? "");
    if (!destino) return "sin destino";
    const url = destino.startsWith("http")
      ? destino
      : `https://www.google.com/search?q=${encodeURIComponent(destino)}`;
    await vista.navigate(url);
    await Bun.sleep(900);
    return `navegado a ${url}`;
  }

  if (n.includes("back")) {
    await vista.back();
    await Bun.sleep(600);
    return "atrás";
  }

  if (n.includes("forward")) {
    await vista.forward();
    await Bun.sleep(600);
    return "adelante";
  }

  if (n.includes("wait")) {
    await Bun.sleep(Math.min(5000, Number(args.seconds ?? 2) * 1000 || 2000));
    return "esperado";
  }

  if (n.includes("scroll")) {
    const direccion = String(args.direction ?? "down").toLowerCase();
    const magnitud = Number(args.amount ?? args.dy ?? 400) || 400;
    const dy = direccion.includes("up") ? -magnitud : magnitud;
    const dx = direccion.includes("left") ? -magnitud : direccion.includes("right") ? magnitud : 0;
    await vista.scroll(dx, dy || 0);
    await Bun.sleep(350);
    return `scroll ${direccion}`;
  }

  if (n.includes("hover") || n === "move" || n.includes("mouse_move")) {
    return String(await vista.evaluate(guionHover(x, y)));
  }

  if (n.includes("type") || n.includes("write")) {
    const texto = String(args.text ?? args.value ?? "");
    // Si trae coordenadas, primero hay que poner el foco donde toca.
    if (args.x !== undefined) await vista.evaluate(guionClic(x, y, 0, 1));
    await vista.type(texto);
    if (args.press_enter === true || args.submit === true) await vista.press("Enter");
    return `escrito: ${texto.slice(0, 40)}`;
  }

  if (n.includes("key") || n.includes("press") || n.includes("hotkey")) {
    const combinacion = String(args.keys ?? args.key ?? args.combination ?? "");
    const partes = combinacion.split(/[+\s]+/).filter(Boolean);
    const tecla = partes.pop() ?? "";
    if (!tecla) return "sin tecla";
    await vista.press(tecla, partes.length ? { modifiers: partes } : undefined);
    return `tecla ${combinacion}`;
  }

  if (n.includes("drag")) {
    const x2 = aPixeles(args.destination_x ?? args.to_x ?? args.x2, viewport.width);
    const y2 = aPixeles(args.destination_y ?? args.to_y ?? args.y2, viewport.height);
    return String(
      await vista.evaluate(`(() => {
        const a = document.elementFromPoint(${x}, ${y});
        const b = document.elementFromPoint(${x2}, ${y2});
        if (!a || !b) return "sin-elemento";
        a.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: ${x}, clientY: ${y} }));
        b.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: ${x2}, clientY: ${y2} }));
        b.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: ${x2}, clientY: ${y2} }));
        return "arrastrado";
      })()`),
    );
  }

  if (n.includes("screenshot")) return "captura tomada";

  if (n.includes("click")) {
    const boton = n.includes("right") ? 2 : n.includes("middle") ? 1 : 0;
    const veces = n.includes("triple") ? 3 : n.includes("double") ? 2 : 1;
    const resultado = String(await vista.evaluate(guionClic(x, y, boton, veces)));
    await Bun.sleep(450);
    return `clic en (${x},${y}) → ${resultado}`;
  }

  return `acción no soportada: ${nombre}`;
}

/** ¿El modelo pide confirmación humana para esta acción? */
function pideConfirmacion(args: Record<string, unknown>): boolean {
  const decision = String(args.safety_decision ?? (args.safety as any)?.decision ?? "").toLowerCase();
  return decision.includes("confirm");
}

export const computerUseTaskTool: Tool = {
  name: "computer_use_task",
  description:
    "Opera el navegador de Hive mirando la pantalla: hace clic, escribe y navega guiado por lo que ve. " +
    "Úsalo cuando la página no tenga selectores estables o cuando browser_click/browser_type no basten. " +
    "Actúa sobre el navegador de Hive, NUNCA sobre la pantalla del usuario. " +
    "Spanish: usar el navegador, hacer clic, operar una página, rellenar un formulario",
  timeoutMs: 240_000,
  parameters: {
    type: "object",
    properties: {
      objetivo: {
        type: "string",
        description:
          "Qué hay que lograr, en una frase concreta y verificable. Ej: 'buscar el precio del dólar en el Banco de la República y leer la cifra'.",
      },
      url: { type: "string", description: "Página desde la que empezar (opcional)." },
      max_pasos: { type: "number", description: `Tope de acciones (default ${MAX_PASOS}).` },
      confirmado: {
        type: "boolean",
        description:
          "Ponlo en true SOLO si el usuario ya aprobó explícitamente una acción que quedó pendiente de confirmación.",
      },
    },
    required: ["objetivo"],
  },
  execute: async (params: Record<string, unknown>, _config?: any) => {
    const objetivo = String(params.objetivo ?? "").trim();
    if (!objetivo) return { ok: false, error: "Falta el objetivo." };

    const maxPasos = Math.max(1, Math.min(30, Number(params.max_pasos) || MAX_PASOS));
    const confirmado = params.confirmado === true;

    const apiKey = (await loadProviderApiKey("gemini")) || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "Falta la API key de Gemini (Ajustes → Proveedores)." };
    }

    const servicio = getBrowserService();
    if (!servicio?.isAvailable()) {
      return { ok: false, error: "El navegador de Hive no está disponible." };
    }
    const vista = (await servicio.getView()) as unknown as Vista | null;
    if (!vista) return { ok: false, error: "No se pudo abrir el navegador de Hive." };

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    // El resize es un intento, no un requisito: algunos motores del WebView no
    // implementan `Emulation.setDeviceMetricsOverride` y lanzan. Lo que importa
    // es medir después el viewport de verdad, porque es contra ese tamaño
    // —no contra el que pedimos— que hay que escalar las coordenadas del modelo.
    try {
      await vista.resize(VIEWPORT.width, VIEWPORT.height);
    } catch (error) {
      log.info(`el motor no permite fijar el viewport: ${(error as Error).message}`);
    }

    if (params.url) {
      await vista.navigate(String(params.url));
      await Bun.sleep(900);
    }

    const medido = await vista
      .evaluate<{ w: number; h: number }>("({ w: window.innerWidth, h: window.innerHeight })")
      .catch(() => null);
    const viewport = {
      width: Number(medido?.w) || VIEWPORT.width,
      height: Number(medido?.h) || VIEWPORT.height,
    };
    log.info(`viewport real: ${viewport.width}x${viewport.height}`);

    const capturar = async (): Promise<string> =>
      vista.screenshot({ encoding: "base64", format: "jpeg", quality: 70 });

    const historial: any[] = [
      {
        role: "user",
        parts: [
          { text: `Objetivo: ${objetivo}\nURL actual: ${vista.url}` },
          { inlineData: { mimeType: "image/jpeg", data: await capturar() } },
        ],
      },
    ];

    const acciones: string[] = [];

    for (let paso = 0; paso < maxPasos; paso++) {
      const respuesta = await ai.models.generateContent({
        model: MODELO,
        contents: historial,
        config: {
          tools: [{ computerUse: { environment: "ENVIRONMENT_BROWSER" } }],
        } as any,
      });

      const partes = respuesta.candidates?.[0]?.content?.parts ?? [];
      const llamada = partes.find((p: any) => p.functionCall)?.functionCall;
      const texto = partes
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join(" ")
        .trim();

      if (!llamada) {
        log.info(`objetivo cumplido en ${paso} acciones`);
        return { ok: true, completado: true, pasos: paso, acciones, resultado: texto || "Hecho.", url: vista.url };
      }

      const args = (llamada.args ?? {}) as Record<string, unknown>;

      // La confirmación no se resuelve aquí: el runtime de tools no puede
      // preguntarle a nadie. Se devuelve el control al coordinador, que sí
      // habla con el usuario, y la tarea se reanuda con `confirmado: true`.
      if (pideConfirmacion(args) && !confirmado) {
        log.info(`pausada por seguridad: ${llamada.name}`);
        return {
          ok: true,
          completado: false,
          pendiente_confirmacion: true,
          accion: llamada.name,
          intencion: String(args.intent ?? texto ?? ""),
          acciones,
          url: vista.url,
          nota:
            "Esta acción necesita el visto bueno del usuario. Pregúntale con tus palabras y, si acepta, " +
            "vuelve a llamar a computer_use_task con el mismo objetivo y confirmado: true.",
        };
      }

      const resultado = await ejecutarAccion(vista, String(llamada.name), args, viewport);
      acciones.push(`${llamada.name}: ${resultado}`);
      log.info(`paso ${paso + 1}/${maxPasos} — ${llamada.name} → ${resultado}`);

      // Se devuelve el contenido del modelo TAL CUAL vino, sin reconstruirlo.
      // Gemini 3.x firma cada functionCall con un `thoughtSignature` y rechaza
      // el turno siguiente si falta: reconstruir la parte a mano cortaba el
      // bucle en la segunda acción con un 400.
      historial.push(respuesta.candidates?.[0]?.content ?? { role: "model", parts: [{ functionCall: llamada }] });
      historial.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: llamada.name,
              response: { output: resultado, url: vista.url },
            },
          },
          { inlineData: { mimeType: "image/jpeg", data: await capturar() } },
        ],
      });
    }

    return {
      ok: true,
      completado: false,
      pasos: maxPasos,
      acciones,
      url: vista.url,
      nota: `Se alcanzó el tope de ${maxPasos} acciones sin terminar. Revisa el objetivo o divídelo en partes.`,
    };
  },
};
