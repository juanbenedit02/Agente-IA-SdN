"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRScreen from "./QRScreen";
import DashboardHeader from "./DashboardHeader";
import ConversationList from "./ConversationList";
import ConversationPanel from "./ConversationPanel";

interface Conversation {
  id: number;
  phone: string;
  name: string | null;
  mode: "AI" | "HUMAN";
  last_message_at: number | null;
  last_message_preview: string | null;
}

export default function ConnectionGate() {
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) {
      const data: Conversation[] = await res.json();
      setConversations(data);
    }
  }, []);

  // polling de estado de conexión y conversaciones (cuando conectado)
  useEffect(() => {
    if (!connectedPhone) return;

    fetchConversations();
    pollRef.current = setInterval(async () => {
      await fetchConversations();

      // verificar que la conexión sigue activa
      const res = await fetch("/api/connection/status");
      if (res.ok) {
        const json = await res.json();
        if (json.status !== "connected") {
          setConnectedPhone(null);
        }
      }
    }, 2_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [connectedPhone, fetchConversations]);

  function handleConnected(phone: string) {
    setConnectedPhone(phone);
  }

  function handleDisconnect() {
    setConnectedPhone(null);
    setSelectedId(null);
    setConversations([]);
  }

  function handleModeChange(mode: "AI" | "HUMAN") {
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, mode } : c))
    );
  }

  function handleDeleted() {
    setSelectedId(null);
    fetchConversations();
  }

  if (!connectedPhone) {
    return <QRScreen onConnected={handleConnected} />;
  }

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex flex-col h-screen bg-gray-950">
      <DashboardHeader phone={connectedPhone} onDisconnect={handleDisconnect} />

      <div className="flex flex-1 overflow-hidden">
        {/* Lista de conversaciones */}
        <aside className="w-80 flex-shrink-0 border-r border-gray-800 overflow-y-auto bg-gray-900">
          <div className="px-4 py-3 border-b border-gray-800">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Conversaciones
            </h2>
          </div>
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>

        {/* Panel de conversación */}
        <main className="flex-1 overflow-hidden bg-gray-950">
          {selected ? (
            <ConversationPanel
              key={selected.id}
              conversation={selected}
              onModeChange={handleModeChange}
              onDeleted={handleDeleted}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600">
              <p>Seleccioná una conversación</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
