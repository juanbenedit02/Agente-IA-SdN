"use client";

interface Props {
  phone: string;
  onDisconnect: () => void;
}

export default function DashboardHeader({ phone, onDisconnect }: Props) {
  async function handleDisconnect() {
    await fetch("/api/connection/disconnect", { method: "POST" });
    onDisconnect();
  }

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800">
      <div className="flex items-center gap-3">
        <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse" />
        <span className="text-sm font-semibold text-gray-100">
          Agente WhatsApp
        </span>
        <span className="text-xs text-gray-400">conectado como {phone}</span>
      </div>
      <button
        onClick={handleDisconnect}
        className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white rounded-lg transition-colors"
      >
        Desconectar
      </button>
    </header>
  );
}
