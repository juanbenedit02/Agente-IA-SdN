"use client";

import { useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import ModeToggle from "./ModeToggle";

interface Message {
  id: number;
  role: "user" | "assistant" | "human";
  content: string;
  created_at: number;
}

interface Conversation {
  id: number;
  phone: string;
  name: string | null;
  mode: "AI" | "HUMAN";
}

interface Props {
  conversation: Conversation;
  onModeChange: (mode: "AI" | "HUMAN") => void;
  onDeleted: () => void;
}

export default function ConversationPanel({
  conversation,
  onModeChange,
  onDeleted,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    fetchMessages();
  }, [conversation.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function fetchMessages() {
    const res = await fetch(`/api/messages/${conversation.id}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data);
    }
  }

  async function sendMessage() {
    const content = input.trim();
    if (!content || sending) return;

    setSending(true);
    setInput("");

    await fetch(`/api/messages/${conversation.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    await fetchMessages();
    setSending(false);
  }

  async function handleDelete() {
    await fetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
    setConfirmDelete(false);
    onDeleted();
  }

  const displayName = conversation.name || conversation.phone;

  return (
    <div className="flex flex-col h-full">
      {/* Header del panel */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
        <div>
          <h2 className="font-semibold text-gray-100">{displayName}</h2>
          <p className="text-xs text-gray-500">{conversation.phone}</p>
        </div>
        <div className="flex items-center gap-3">
          <ModeToggle
            conversationId={conversation.id}
            mode={conversation.mode}
            onChange={onModeChange}
          />
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">¿Confirmar?</span>
              <button
                onClick={handleDelete}
                className="text-xs px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded"
              >
                Sí, borrar
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs px-3 py-1 bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white rounded transition-colors"
            >
              Borrar
            </button>
          )}
        </div>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-center text-gray-600 text-sm mt-8">
            Sin mensajes aún
          </p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="px-4 py-3 border-t border-gray-800 bg-gray-900">
        {conversation.mode === "AI" ? (
          <p className="text-sm text-gray-500 text-center py-1">
            El bot responde automáticamente en modo IA
          </p>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="Escribir mensaje..."
              className="flex-1 bg-gray-800 text-gray-100 placeholder-gray-500 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
            <button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-gray-900 font-semibold rounded-lg text-sm transition-colors"
            >
              {sending ? "..." : "Enviar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
