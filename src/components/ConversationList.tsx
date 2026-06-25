"use client";

interface Conversation {
  id: number;
  phone: string;
  name: string | null;
  mode: "AI" | "HUMAN";
  last_message_at: number | null;
  last_message_preview: string | null;
}

function timeAgo(unixSeconds: number | null): string {
  if (!unixSeconds) return "";
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

interface Props {
  conversations: Conversation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export default function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: Props) {
  if (conversations.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 text-sm">
        Sin conversaciones aún.
        <br />
        Esperando mensajes...
      </div>
    );
  }

  return (
    <ul>
      {conversations.map((c) => (
        <li
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={`px-4 py-3 cursor-pointer border-b border-gray-800 hover:bg-gray-800 transition-colors ${
            selectedId === c.id ? "bg-gray-800" : ""
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-gray-100 truncate">
              {c.name || c.phone}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-semibold ml-2 flex-shrink-0 ${
                c.mode === "AI"
                  ? "bg-emerald-900 text-emerald-300"
                  : "bg-amber-900 text-amber-300"
              }`}
            >
              {c.mode === "AI" ? "IA" : "HUMAN"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400 truncate flex-1">
              {c.last_message_preview ?? "Sin mensajes"}
            </p>
            <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
              {timeAgo(c.last_message_at)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
