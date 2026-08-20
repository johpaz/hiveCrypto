/**
 * Conversación con el coordinador, compartida por todas las pantallas.
 *
 * Antes esto vivía dentro de `WebChatPage`: la suscripción a los eventos de
 * respuesta, la carga del historial y el envío. Al querer delegar también desde
 * la pantalla de trading hacía falta sacarlo, porque montar dos veces las
 * suscripciones haría que **cada trozo de respuesta se procesara dos veces**.
 *
 * De ahí la división en dos hooks:
 *
 *   useAgentChatBridge()  se monta UNA sola vez, en AppLayout. Suscribe, carga
 *                         historial y vigila la conexión.
 *   useAgentChat()        no suscribe nada. Sólo envía y lee del store, así que
 *                         es seguro llamarlo desde cualquier página.
 *
 * La sesión es `currentUser.id`, la misma en toda la app: una orden delegada
 * desde /trading y una pregunta escrita en /chat son la misma conversación.
 */

import { useCallback, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useUserStore } from "@/stores/userStore";
import { useChatStreaming } from "@/hooks/useChatStreaming";
import { apiClient } from "@/lib/api";
import { generateId } from "@/lib/utils";

/** El coordinador. Nunca se habla directo con un especialista. */
export const AGENT_ID = "main";

const HISTORY_LIMIT = 40;

/**
 * `useChatStreaming` guarda en una ref interna qué burbuja está recibiendo
 * chunks. Al enviar un mensaje nuevo hay que limpiarla, o el siguiente trozo de
 * respuesta se pegaría a la burbuja anterior. Como el hook vive en AppLayout y
 * el envío puede venir de otra página, el puente deja aquí su función de reset
 * para que `send()` la alcance.
 */
let resetStreaming: (() => void) | null = null;

export interface ChatAttachmentLike {
  type: "image" | "document";
  base64: string;
  mimeType: string;
  fileName?: string;
}

export interface SendOptions {
  audio?: string;
  audioMimeType?: string;
  attachments?: ChatAttachmentLike[];
}

/** La sesión de chat del usuario actual. */
export function useChatSessionId(): string {
  const currentUser = useUserStore(s => s.currentUser);
  return currentUser?.id || "default";
}

/**
 * Puente de la conversación: suscripciones, historial y estado de conexión.
 * MONTAR UNA SOLA VEZ — ver la cabecera de este archivo.
 */
export function useAgentChatBridge() {
  const sessionId = useChatSessionId();
  const { status, subscribe } = useWebSocket();
  const addMessage = useChatStore(s => s.addMessage);
  const setMessages = useChatStore(s => s.setMessages);
  const setConnectionWarning = useChatStore(s => s.setConnectionWarning);
  const currentUser = useUserStore(s => s.currentUser);
  const fetchUser = useUserStore(s => s.fetchUser);

  const {
    handleStreamingChunk, handleReasoningChunk, handleAudioMessage,
    handleProgress, handleProcess, handleTyping, resetStreamingRef,
  } = useChatStreaming(AGENT_ID, sessionId);

  useEffect(() => {
    if (!currentUser) fetchUser();
  }, [currentUser, fetchUser]);

  useEffect(() => {
    resetStreaming = resetStreamingRef;
    return () => { resetStreaming = null; };
  }, [resetStreamingRef]);

  // El gateway manda `type: "error"` cuando el turno no se puede procesar. Sin
  // este handler la burbuja se queda en "Pensando" para siempre y el motivo
  // sólo existe en los logs.
  const handleGatewayError = useCallback(
    (payload: { error?: string }) => {
      useChatStore.getState().setLoading(false);
      addMessage({
        id: generateId(),
        conversationId: sessionId,
        type: "error" as never,
        content: payload?.error || "El gateway no pudo procesar el mensaje.",
        timestamp: new Date().toISOString(),
      } as never);
    },
    [addMessage, sessionId]
  );

  useEffect(() => {
    const unsubs = [
      subscribe("message", handleStreamingChunk),
      subscribe("response", handleStreamingChunk),
      subscribe("reasoning", handleReasoningChunk),
      subscribe("audio", handleAudioMessage),
      subscribe("progress", handleProgress),
      subscribe("process", handleProcess),
      subscribe("typing", handleTyping),
      subscribe("error", handleGatewayError),
    ];
    return () => unsubs.forEach(u => u());
  }, [
    subscribe, handleStreamingChunk, handleReasoningChunk, handleAudioMessage,
    handleProgress, handleProcess, handleTyping, handleGatewayError,
  ]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await apiClient<{ messages: Record<string, unknown>[] }>(
          `/api/chat/history?sessionId=${sessionId}&limit=${HISTORY_LIMIT}`
        );
        if (cancelled || !response.messages) return;
        setMessages(
          response.messages
            .filter(m => m.role === "user" || m.role === "assistant")
            .map(m => ({
              id: m.id,
              conversationId: m.session_id || m.thread_id,
              type: m.role === "user" ? "user" : "agent",
              content: m.content,
              agentId: AGENT_ID,
              timestamp: m.created_at,
            })) as never
        );
      } catch (error) {
        console.error("No se pudo cargar el historial del chat:", error);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, setMessages]);

  useEffect(() => {
    if (status === "connected") setConnectionWarning(null);
    else if (status !== "connecting") setConnectionWarning("Conexión perdida. Reconectando…");
  }, [status, setConnectionWarning]);
}

/**
 * Enviar al coordinador y leer el estado de la conversación.
 * Seguro de usar en cualquier página: no suscribe nada.
 */
export function useAgentChat() {
  const sessionId = useChatSessionId();
  const { status, send: wsSend } = useWebSocket();
  const addMessage = useChatStore(s => s.addMessage);
  const messages = useChatStore(s => s.messages);
  const isLoading = useChatStore(s => s.isLoading);

  const isConnected = status === "connected";

  const send = useCallback(
    (content: string, options?: SendOptions) => {
      const messageId = generateId();
      resetStreaming?.();
      const attachments = options?.attachments;
      const audioBase64 = options?.audio;
      const audioMimeType = options?.audioMimeType || "audio/webm";

      const local: Record<string, unknown> = {
        id: messageId,
        conversationId: sessionId,
        type: "user",
        content,
        agentId: AGENT_ID,
        timestamp: new Date().toISOString(),
      };

      if (audioBase64) local.audio = { base64: audioBase64, mimeType: audioMimeType };

      // El gateway acepta una imagen y un documento por turno; el store local
      // guarda todos, pero al cable sólo van el primero de cada tipo.
      const firstImage = attachments?.find(a => a.type === "image");
      const firstDoc = attachments?.find(a => a.type === "document");
      if (firstImage) {
        local.image = { base64: firstImage.base64, mimeType: firstImage.mimeType, caption: firstImage.fileName };
      }
      if (firstDoc) {
        local.document = { base64: firstDoc.base64, mimeType: firstDoc.mimeType, fileName: firstDoc.fileName };
      }

      addMessage(local as never);

      if (!isConnected) {
        addMessage({
          id: generateId(),
          conversationId: sessionId,
          type: "error",
          content: "No se pudo conectar al agente. Verifica que el gateway esté funcionando.",
          timestamp: new Date().toISOString(),
        } as never);
        useChatStore.getState().setLoading(false);
        return false;
      }

      useChatStore.getState().setLoading(true);

      if (audioBase64) {
        wsSend({
          type: "audio", audio: audioBase64, mimeType: audioMimeType,
          sessionId, timestamp: new Date().toISOString(),
        });
      } else {
        const payload: Record<string, unknown> = {
          type: "message", content, sessionId, timestamp: new Date().toISOString(),
        };
        if (firstImage) payload.image = { base64: firstImage.base64, mimeType: firstImage.mimeType, caption: firstImage.fileName };
        if (firstDoc) payload.document = { base64: firstDoc.base64, mimeType: firstDoc.mimeType, fileName: firstDoc.fileName };
        wsSend(payload);
      }
      return true;
    },
    [isConnected, sessionId, addMessage, wsSend]
  );

  return { send, isConnected, isLoading, messages, sessionId };
}
