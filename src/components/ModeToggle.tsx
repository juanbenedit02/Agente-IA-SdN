"use client";

interface Props {
  conversationId: number;
  mode: "AI" | "HUMAN";
  onChange: (mode: "AI" | "HUMAN") => void;
}

export default function ModeToggle({ conversationId, mode, onChange }: Props) {
  async function toggle() {
    const next = mode === "AI" ? "HUMAN" : "AI";
    await fetch(`/api/mode/${conversationId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: next }),
    });
    onChange(next);
  }

  return (
    <button
      onClick={toggle}
      className={`px-3 py-1 rounded-full text-sm font-semibold transition-colors ${
        mode === "AI"
          ? "bg-emerald-600 hover:bg-emerald-500 text-white"
          : "bg-amber-500 hover:bg-amber-400 text-gray-900"
      }`}
    >
      {mode === "AI" ? "Modo IA" : "Modo Humano"}
    </button>
  );
}
