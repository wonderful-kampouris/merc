import { Alert } from "@wonderful/ui-base";
import type { ReactNode } from "react";

export interface FeedbackMessage {
  kind: "success" | "info" | "warning" | "error";
  text: string;
  detail?: string;
}

/** The result of the last action on the screen, inline and dismissable (the host does not show app toasts). */
export default function Feedback({ message, onClose, action }: { message: FeedbackMessage | null; onClose: () => void; action?: ReactNode }) {
  if (!message) return null;
  return (
    <Alert variant={message.kind} size="compact" title={message.text} description={message.detail} action={action} isClosable onClose={onClose} />
  );
}
