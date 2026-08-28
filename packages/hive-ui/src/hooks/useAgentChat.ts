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
 * La sesión es `currentUser.id`, la misma en toda la app: identifica el socket y
 * al usuario. La conversación abierta es otra cosa —`useConversationsStore.activeId`—
 * y es la que decide en qué hilo se escribe: una orden delegada desde /trading y una
 * pregunta escrita en /chat caen en la conversación que el usuario tenga abierta.
 */

import { useCallback, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useConversationsStore } from "@/stores/conversationsStore";
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

/** La sesión de chat del usuario actual. Identifica el socket, no la conversación. */
export function useChatSessionId(): string {
  const currentUser = useUserStore(s => s.currentUser);
  return currentUser?.id || "default";
}

/** La conversación abierta. `null` hasta que se carga la lista por primera vez. */
export function useActiveThreadId(): string | null {
  return useConversationsStore(s => s.activeId);
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
  const clearMessages = useChatStore(s => s.clearMessages);
  const setConnectionWarning = useChatStore(s => s.setConnectionWarning);
  const currentUser = useUserStore(s => s.currentUser);
  const fetchUser = useUserStore(s => s.fetchUser);
  const threadId = useConversationsStore(s => s.activeId);
  const conversations = useConversationsStore(s => s.conversations);
  const isLoadingConversations = useConversationsStore(s => s.isLoading);
  const fetchConversations = useConversationsStore(s => s.fetchConversations);
  const createConversation = useConversationsStore(s => s.createConversation);

  const {
    handleStreamingChunk, handleReasoningChunk, handleAudioMessage,
    handleProgress, handleProcess, handleTyping, resetStreamingRef,
  } = useChatStreaming(AGENT_ID, threadId ?? sessionId);

  useEffect(() => {
    if (!currentUser) fetchUser();
  }, [currentUser, fetchUser]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Primera visita (o después de borrar la última): siempre tiene que haber una
  // conversación abierta donde escribir.
  useEffect(() => {
    if (!isLoadingConversations && conversations.length === 0 && !threadId) {
      createConversation();
    }
  }, [isLoadingConversations, conversations.length, threadId, createConversation]);

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
        conversationId: threadId ?? sessionId,
        type: "error" as never,
        content: payload?.error || "El gateway no pudo procesar el mensaje.",
        timestamp: new Date().toISOString(),
      } as never);
    },
    [addMessage, sessionId, threadId]
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

  // El historial se recarga al cambiar de conversación. clearMessages() primero:
  // el store persiste los últimos mensajes en localStorage y sin limpiarlo se vería
  // por un instante la conversación anterior dentro de la nueva.
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    (async () => {
      clearMessages();
      try {
        const response = await apiClient<{ messages: Record<string, unknown>[] }>(
          `/api/chat/history?threadId=${encodeURIComponent(threadId)}&limit=${HISTORY_LIMIT}`
        );
        if (cancelled || !response.messages) return;
        setMessages(
          response.messages
            .filter(m => m.role === "user" || m.role === "assistant")
            .map(m => ({
              id: m.id,
              conversationId: m.thread_id,
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
  }, [threadId, setMessages, clearMessages]);

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
  // threadId dice en qué conversación escribir; sin él, el gateway usa la más
  // reciente de la web.
  const threadId = useActiveThreadId();
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
        conversationId: threadId ?? sessionId,
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
          conversationId: threadId ?? sessionId,
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
          sessionId, threadId, timestamp: new Date().toISOString(),
        });
      } else {
        const payload: Record<string, unknown> = {
          type: "message", content, sessionId, threadId, timestamp: new Date().toISOString(),
        };
        if (firstImage) payload.image = { base64: firstImage.base64, mimeType: firstImage.mimeType, caption: firstImage.fileName };
        if (firstDoc) payload.document = { base64: firstDoc.base64, mimeType: firstDoc.mimeType, fileName: firstDoc.fileName };
        wsSend(payload);
      }
      return true;
    },
    [isConnected, sessionId, threadId, addMessage, wsSend]
  );

  return { send, isConnected, isLoading, messages, sessionId, threadId };
}
