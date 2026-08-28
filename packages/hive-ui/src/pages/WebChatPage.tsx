import { useEffect, useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useWebSocketStore } from "@/stores/useWebSocketStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useUserStore } from "@/stores/userStore";
import { useGlobalConfigStore } from "@/stores/useGlobalConfigStore";
import { useNarration } from "@/hooks/useNarration";
import { useAgentChat, AGENT_ID } from "@/hooks/useAgentChat";
import { ChatHistory } from "@/modules/chat/ChatHistory";
import { ConversationList } from "@/modules/chat/ConversationList";
import { ChatInput, type ChatAttachment } from "@/modules/chat/ChatInput";
import { apiClient } from "@/lib/api";
import { generateId } from "@/lib/utils";
import { Bot, Volume2, VolumeX, AlertCircle, RefreshCw } from "lucide-react";

const WEBCHAT_HISTORY_LIMIT = 40;

export function WebChatPage() {
  const agentId = AGENT_ID;
  // Las suscripciones, el historial y el aviso de conexión los monta
  // useAgentChatBridge() en AppLayout — aquí sólo se lee y se envía.
  const { messages, currentSteps, streamingMessageId, connectionWarning } = useChatStore();
  // `send` es el canal crudo, para el botón de detener; el envío normal va por
  // useAgentChat. `currentUser` lo usan el nombre en el historial y el botón de
  // reintentar la conexión: los dos se perdieron en un refactor y el archivo
  // quedó llamando a nombres que ya no existían.
  const { status, send } = useWebSocket();
  const { currentUser } = useUserStore();
  const agents = useGlobalConfigStore((s) => s.agents);
  const fetchAgents = useGlobalConfigStore((s) => s.fetchAgents);
  // `threadId` es la conversación abierta: el botón de detener para ESA cola, no
  // todo lo que el usuario tenga en vuelo.
  const { send: sendToAgent, isLoading, sessionId, threadId } = useAgentChat();
  const narration = useNarration();

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  const coordinator = agents.find((a) => a.role === "coordinator" && a.enabled);
  const agentName = coordinator?.name ?? "Coordinador";

  useEffect(() => {
    if (agents.length === 0) fetchAgents();
  }, []);



  const handleSendMessage = useCallback(
    (content: string, options?: { audio?: string, audioMimeType?: string, attachments?: ChatAttachment[] }) => {
      narration.stop();
      sendToAgent(content, options);
    },
    [sendToAgent, narration]
  );

  const handleNarrateMessage = useCallback(
    (text: string) => {
      if (narration.isSpeaking) {
        narration.stop();
      } else {
        narration.narrate(text);
      }
    },
    [narration]
  );

  return (
    <div className="flex-1 flex w-full min-h-0 bg-transparent overflow-hidden">
      <ConversationList />

      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
      {/* ── Minimal Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 z-10 bg-transparent border-b border-white/5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white font-manrope tracking-tight">{agentName}</span>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected ? "bg-emerald-500" : isConnecting ? "bg-amber-500 animate-pulse" : "bg-slate-400"
              }`}
            />
            <span className="text-[10px] font-medium text-white/50 uppercase tracking-wider">
              {isConnected ? "Conectado" : isConnecting ? "Conectando" : "Desconectado"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={narration.toggle}
          className={`h-8 w-8 rounded-full flex items-center justify-center transition-all ${
            narration.isEnabled
              ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
              : "text-white/40 hover:text-white/70 hover:bg-white/5"
          }`}
          title={narration.isEnabled ? "Desactivar narracion" : "Activar narracion"}
          aria-label={narration.isEnabled ? "Desactivar narracion" : "Activar narracion"}
        >
          {narration.isEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      </div>
      {/* ── Connection Warning ────────────────────────────────────────── */}
      {connectionWarning && !isConnected && (
        <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 border-b border-rose-100 shrink-0">
          <AlertCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
          <span className="text-xs text-rose-600 flex-1 font-medium">{connectionWarning}</span>
          <button
            type="button"
            onClick={() => {
              const { connect } = useWebSocketStore.getState();
              if (currentUser?.id) connect(currentUser.id);
            }}
            className="flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:text-rose-800 transition-colors uppercase tracking-wider"
          >
            <RefreshCw className="h-3 w-3" />
            Reintentar
          </button>
        </div>
      )}

      {/* ── Narration Active Indicator ─────────────────────────────────── */}
      {narration.isSpeaking && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 border-b border-blue-500/20 shrink-0">
          <div className="flex gap-0.5">
            <span className="h-1.5 w-0.5 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: "0ms" }} />
            <span className="h-1.5 w-0.5 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="h-1.5 w-0.5 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="text-[10px] text-blue-400 font-medium font-manrope">Narrando{narration.currentText ? `: ${narration.currentText}...` : "..."}</span>
          <button type="button" onClick={narration.stop} className="text-[10px] text-blue-500 hover:text-blue-300 ml-auto font-bold uppercase tracking-wider">
            Detener
          </button>
        </div>
      )}

      {/* ── Messages ────────────────────────────────────────────────── */}
      <ChatHistory
        messages={messages}
        isLoading={isLoading}
        currentSteps={currentSteps}
        streamingMessageId={streamingMessageId}
        userName={currentUser?.name ?? "Usuario"}
        agentName={agentName}
        onSuggestionClick={handleSendMessage}
        onNarrateMessage={narration.isEnabled ? handleNarrateMessage : undefined}
      />

      {/* ── Input ─────────────────────────────────────────────────────── */}
      <ChatInput
        onSendMessage={handleSendMessage}
        onStop={() => {
          if (isConnected) send({ type: "stop", sessionId, threadId });
        }}
        disabled={!isConnected && !isConnecting}
        isStreaming={isLoading}
      />
      </div>
    </div>
  );
}
