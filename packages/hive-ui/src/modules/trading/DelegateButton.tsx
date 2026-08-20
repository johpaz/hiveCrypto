/**
 * Botón que delega una acción en el agente.
 *
 * La pantalla ya sabe el símbolo, la temporalidad y el importe, así que la
 * frase se compone sola: el usuario no tiene que redactarla ni cambiar de
 * pantalla para pedir lo mismo que está viendo.
 */

import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** La frase que recibirá el coordinador. */
  prompt: string;
  onDelegate: (prompt: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "sm" | "default" | "icon";
}

export function DelegateButton({
  prompt, onDelegate, children, disabled, className,
  variant = "outline", size = "sm",
}: Props) {
  return (
    <Button
      variant={variant}
      size={size}
      className={cn("gap-1.5", className)}
      disabled={disabled}
      onClick={() => onDelegate(prompt)}
      // El title deja ver la frase exacta antes de mandarla: nada de que el
      // agente reciba algo distinto de lo que el usuario cree que pidió.
      title={prompt}
    >
      <Bot className="h-3.5 w-3.5 shrink-0" />
      {children}
    </Button>
  );
}
