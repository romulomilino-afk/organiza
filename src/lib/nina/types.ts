/** Tipos compartilhados entre servidor e interface (sem dependências de servidor). */
export type Card = { icon: string; title: string; lines: string[] };

export type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  cards: Card[];
  suggestion: { text: string; yes: string; no: string } | null;
  createdAt: string;
};

export type ChatResponse = { user: ChatMessage; assistant: ChatMessage; mode: "ai" | "rules" };
export type SuggestionResponse = { followUp: string | null; messages: ChatMessage[] };
