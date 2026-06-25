interface Message {
  id: number;
  role: "user" | "assistant" | "human";
  content: string;
  created_at: number;
}

function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isHuman = message.role === "human";

  return (
    <div className={`flex ${isUser ? "justify-start" : "justify-end"} mb-3`}>
      <div
        className={`max-w-[75%] px-4 py-2 rounded-2xl text-sm ${
          isUser
            ? "bg-white text-gray-900 border border-gray-200"
            : isAssistant
            ? "bg-emerald-600 text-white"
            : "bg-amber-500 text-gray-900"
        }`}
      >
        {isHuman && (
          <p className="text-xs font-semibold mb-1 opacity-70">Tú (humano)</p>
        )}
        <p className="whitespace-pre-wrap">{message.content}</p>
        <p
          className={`text-xs mt-1 ${
            isUser ? "text-gray-400" : "opacity-60"
          } text-right`}
        >
          {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}
