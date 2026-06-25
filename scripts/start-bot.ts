// env-loader DEBE ser el primer import — los ES modules se hoistean
import "./env-loader";

import path from "node:path";
import fs from "node:fs";
import {
  getPendingOutbox,
  markOutboxSent,
  setConnectionState,
} from "../src/lib/db";
import { start, getHandle } from "../src/lib/baileys/client";

const RESTART_FLAG = path.resolve(process.cwd(), "data", ".restart");

async function main() {
  console.log("[bot] Iniciando agente WhatsApp...");
  setConnectionState({ status: "disconnected", qr_string: null, phone: null });

  await start();

  // Outbox: enviar mensajes humanos del dashboard cada 2s
  setInterval(async () => {
    const handle = getHandle();
    if (!handle) return;

    const pending = getPendingOutbox(20);
    for (const item of pending) {
      try {
        const jid = `${item.phone}@s.whatsapp.net`;
        await handle.sock.sendMessage(jid, { text: item.content });
        markOutboxSent(item.id);
        console.log(`[bot] → Outbox enviado a ${item.phone}`);
      } catch (err) {
        console.error(`[bot] Error enviando outbox ${item.id}:`, err);
      }
    }
  }, 2_000);

  // Restart flag: detectar solicitud de desconexión desde el dashboard
  setInterval(async () => {
    if (!fs.existsSync(RESTART_FLAG)) return;

    console.log("[bot] Flag de restart detectado, reiniciando...");
    fs.unlinkSync(RESTART_FLAG);

    const handle = getHandle();
    if (handle) {
      try {
        await handle.shutdown();
      } catch {}
    }

    const authDir = path.resolve(process.cwd(), "auth");
    fs.rmSync(authDir, { recursive: true, force: true });

    await start();
  }, 1_000);
}

main().catch((err) => {
  console.error("[bot] Error fatal:", err);
  process.exit(1);
});
