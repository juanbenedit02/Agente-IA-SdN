"use client";

import { useEffect, useState } from "react";

type Status = "disconnected" | "qr" | "connecting" | "connected";

interface StatusResponse {
  status: Status;
  qrPng?: string;
  phone?: string;
  updatedAt: number;
}

interface Props {
  onConnected: (phone: string) => void;
}

export default function QRScreen({ onConnected }: Props) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [firstSeenDisconnected, setFirstSeenDisconnected] = useState<number>(
    Date.now()
  );

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/connection/status");
        if (!res.ok) return;
        const json: StatusResponse = await res.json();

        if (cancelled) return;

        if (json.status === "connected" && json.phone) {
          onConnected(json.phone);
          return;
        }

        if (json.status === "disconnected") {
          setFirstSeenDisconnected((prev) => prev);
        } else {
          setFirstSeenDisconnected(Date.now());
        }

        setData(json);
      } catch {}
    }

    poll();
    const interval = setInterval(poll, 2_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [onConnected]);

  const disconnectedTooLong =
    data?.status === "disconnected" &&
    Date.now() - firstSeenDisconnected > 10_000;

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
        <h1 className="text-xl font-bold text-gray-100 mb-2">
          Agente WhatsApp
        </h1>
        <p className="text-sm text-gray-400 mb-6">Conectar número</p>

        {data?.status === "qr" && data.qrPng ? (
          <>
            <img
              src={data.qrPng}
              alt="QR de WhatsApp"
              className="mx-auto rounded-xl mb-4 bg-white p-2"
              width={280}
              height={280}
            />
            <div className="flex items-center justify-center gap-2">
              <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              <p className="text-sm text-amber-400">
                Esperando escaneo...
              </p>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo
            </p>
          </>
        ) : data?.status === "connecting" ? (
          <>
            <div className="w-16 h-16 mx-auto mb-4 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <div className="flex items-center justify-center gap-2">
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
              <p className="text-sm text-blue-400">Conectando...</p>
            </div>
          </>
        ) : disconnectedTooLong ? (
          <>
            <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center text-red-400 text-4xl">
              ⚠
            </div>
            <p className="text-sm text-red-400 font-semibold mb-2">
              El bot no responde
            </p>
            <p className="text-xs text-gray-500">
              Asegurate de que el proceso bot esté corriendo:
              <br />
              <code className="text-gray-300 bg-gray-800 px-1 rounded">
                npm run start:bot
              </code>
            </p>
          </>
        ) : (
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-gray-700 border-t-gray-400 rounded-full animate-spin" />
        )}
      </div>
    </div>
  );
}
