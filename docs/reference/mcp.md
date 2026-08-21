# MCP

MCP conecta Hive con herramientas externas mediante servidores `stdio`, `sse` o `websocket`.

## Administración

```bash
hive mcp list
hive mcp add
hive mcp test <nombre>
hive mcp tools <nombre>
hive mcp remove <nombre>
```

La UI permite crear, editar, activar y sincronizar servidores. Las variables secretas deben referenciarse desde el entorno, no escribirse en documentación ni logs.

## Ciclo de vida

1. El manager carga servidores habilitados.
2. Conecta el transporte y descubre tools.
3. Normaliza sus nombres para evitar colisiones.
4. Sincroniza metadatos y `server_id` con HiveDB para que `search_knowledge` pueda encontrarlas.
5. El coordinador busca un especialista persistente para ese servidor.
6. Si no existe, pregunta al usuario antes de crearlo; si el usuario rechaza, ejecuta directamente la solicitud puntual.
7. Una delegación adquiere el lease del servidor persistido en el agente.
8. Al terminar, libera el lease; hot reload puede reemplazar conexiones sin cortar tareas activas.

Cada especialista representa un solo servidor y recibe todas sus tools actuales y futuras. Si una tarea requiere varios servidores, se reutiliza o crea un agente independiente para cada uno.

## Fallos

Una tool MCP ausente o un servidor desconectado no se presenta como éxito. El agente debe devolver evidencia del error y el coordinador puede elegir una alternativa nativa. No se reintentan automáticamente mutaciones no idempotentes.

## Diagnóstico

- Ejecuta `hive mcp test <nombre>`.
- Comprueba binario, argumentos, URL y variables requeridas.
- Revisa `hive logs --follow`.
- Verifica que el servidor esté habilitado y asignado al agente.

## Revisión del protocolo

El cliente usa el SDK v2 (`@modelcontextprotocol/client`) y **negocia la era por servidor**, sin
que haya que tocar ninguna configuración existente.

| Transporte | Negocia | Resultado típico |
|---|---|---|
| `stdio` | sí | `modern` si el servidor habla 2026-07-28; si no, `legacy` |
| `http` | sí | Streamable HTTP del SDK; `modern` contra un servidor nuevo |
| `sse` | **no** | siempre `legacy` — HTTP+SSE está deprecado en la spec |
| `websocket` | **no** | siempre `legacy` — nunca formó parte de la spec |

Con `mode: "auto"` el cliente sondea con `server/discover` al conectar y cae al handshake
`initialize` de la era 2025 si no hay evidencia concluyente de que el servidor sea moderno.

Los dos transportes deprecados **no** sondean, y es deliberado: el `sse` escrito a mano cae al
patrón Streamable HTTP sin enviar las cabeceras `Mcp-Method` y `Mcp-Name` que la revisión
2026-07-28 exige, así que un servidor moderno rechaza el sondeo con `-32020` (HeaderMismatch) y
tumba la conexión entera. Un transporte deprecado se queda en su era; a un servidor moderno se
llega con `http`.

La era negociada aparece en la tarjeta de cada servidor MCP, junto al transporte. Sólo mientras
está conectado: es el resultado de una negociación, no una preferencia de la configuración.

Consecuencia práctica en la era moderna: **no hay sesiones**, así que el reintento por «sesión
caída» deja de aplicar. Un fallo ahí es un fallo real y reconectar sólo escondería el motivo.
