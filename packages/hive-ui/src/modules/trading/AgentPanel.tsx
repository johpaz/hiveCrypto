/**
 * Panel del agente dentro de la pantalla de trading.
 *
 * No es un chat aparte: renderiza los mensajes de `useChatStore`, la misma
 * sesión que `/chat`. Una orden delegada desde aquí aparece en el chat y al
 * revés — es una conversación vista desde dos sitios, no dos conversaciones.
 *
 * Reusa `ChatHistory` para que el streaming, el markdown y el auto-scroll se
 * comporten exactamente igual que en la pantalla de chat.
 */

import { useState, useCallback, type KeyboardEvent } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useAgentChat } from "@/hooks/useAgentChat";
import { useGlobalConfigStore } from "@/stores/useGlobalConfigStore";
import { ChatHistory } from "@/modules/chat/ChatHistory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, X, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentPanel({ open, onOpenChange }: Props) {
  const [draft, setDraft] = useState("");
  const { send, isConnected, isLoading, messages } = useAgentChat();
  const currentSteps = useChatStore(s => s.currentSteps);
  const streamingMessageId = useChatStore(s => s.streamingMessageId);
  const agents = useGlobalConfigStore(s => s.agents);

  const agentName = agents.find(a => a.role === "coordinator" && a.enabled)?.name ?? "Coordinador";

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || !isConnected) return;
    send(text);
    setDraft("");
  }, [draft, isConnected, send]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Velo sólo en pantallas estrechas, donde el panel tapa el gráfico. */}
      <div
        className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col",
          "border-l bg-background shadow-xl"
        )}
        aria-label={`Conversación con ${agentName}`}
      >
        <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold">{agentName}</span>
            {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <Button
            size="icon" variant="ghost" className="h-7 w-7"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar el panel del agente"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1">
          <ChatHistory
            messages={messages}
            isLoading={isLoading}
            currentSteps={currentSteps}
            streamingMessageId={streamingMessageId}
            agentName={agentName}
          />
        </div>

        <div className="shrink-0 border-t p-3">
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={isConnected ? "Escribe al agente…" : "Sin conexión con el gateway"}
              disabled={!isConnected}
              className="h-9"
              aria-label="Mensaje para el agente"
            />
            <Button
              size="icon" className="h-9 w-9 shrink-0"
              onClick={submit}
              disabled={!isConnected || !draft.trim()}
              aria-label="Enviar"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
