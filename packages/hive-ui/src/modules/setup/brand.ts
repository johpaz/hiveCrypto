/**
 * Textos de marca del asistente de configuración.
 *
 * Está aislado en un archivo propio porque es lo único que cambia entre Hive y
 * sus verticales derivados: al derivar uno se edita este archivo y la primera
 * pantalla ya habla del producto correcto, en vez de tener que perseguir
 * cadenas por todo el asistente.
 */

export const SETUP_BRAND = {
  /** Nombre del producto, tal como se muestra al usuario. */
  name: "hiveCrypto",
  /** Bajada corta para la cabecera. Va en mayúsculas por CSS. */
  tagline: "Agentes de trading local-first",
  /** Etiqueta de la pantalla de bienvenida. */
  eyebrow: "Configuración inicial",
  /** Titular de bienvenida. */
  welcomeTitle: "Bienvenido a hiveCrypto",
  /** Párrafo de bienvenida. Dos frases como máximo. */
  welcomeBody:
    "Tu equipo de agentes para mercados cripto: analizan, dimensionan el riesgo y " +
    "operan en simulado contra el libro real. Ninguna operación mueve dinero real.",
  /** Titular de la pantalla final, ya con todo configurado. */
  successTitle: "¡Todo listo!",
} as const;
