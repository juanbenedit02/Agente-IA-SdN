import type makeWASocket from "@whiskeysockets/baileys";
import type { BaileysEventMap } from "@whiskeysockets/baileys";
import {
  getOrCreateConversation,
  insertMessage,
  getConversationById,
  getRecentHistory,
  setNaalooEmployee,
  setPendingAction,
} from "../db";
import { generateReply, interpretarPedidoInsumos } from "../openrouter";
import { getEmpleadoPorNombre, getEmpleadoPorId } from "../naaloo";
import { guardarPedido } from "../pedidos";

type Sock = ReturnType<typeof makeWASocket>;
type UpsertEvent = BaileysEventMap["messages.upsert"];

const MSG_BIENVENIDA =
  "Hola, soy el asistente de RRHH de Suelos del Norte. Para comenzar necesito tu nombre completo. Enviamelo y te identifico enseguida.";

const MSG_NOMBRE_NO_ENCONTRADO =
  "No encontre ningun empleado con ese nombre. Fijate de escribirlo igual que figura en el sistema (nombre y apellido completos).";

const MSG_NOMBRE_ERROR =
  "Tuve un problema al buscarte. Intenta de nuevo en unos minutos.";

const MENU =
  "En que te puedo ayudar? Podes consultarme sobre:\n\n" +
  "- Mis ausencias y licencias\n" +
  "- Mis fichajes y asistencia\n" +
  "- Mis datos laborales (cargo, area, email, fecha de ingreso)\n" +
  "- Mis vacaciones\n" +
  "- Pedido de insumos\n" +
  "- Contactar a la secretaria\n\n" +
  "Escribime lo que necesitas.";

const MSG_IDENTIFICADO = (nombre: string) =>
  `Perfecto, ${nombre}. Te identifique en el sistema.\n\n${MENU}`;

export async function handleIncomingMessages(
  sock: Sock,
  event: UpsertEvent
): Promise<void> {
  console.log(`[bot] messages.upsert tipo=${event.type} cantidad=${event.messages.length}`);
  if (event.type !== "notify") return;

  for (const msg of event.messages) {
    try {
      await processMessage(sock, msg as unknown as Record<string, unknown>);
    } catch (err) {
      console.error("[bot] Error procesando mensaje:", err);
    }
  }
}

async function processMessage(
  sock: Sock,
  msg: Record<string, unknown>
): Promise<void> {
  const key = msg.key as Record<string, unknown>;
  if (key.fromMe) return;

  const remoteJid = (key.remoteJid as string) ?? "";
  if (remoteJid.endsWith("@g.us")) return;
  if (!remoteJid.endsWith("@s.whatsapp.net") && !remoteJid.endsWith("@lid")) return;

  const message = msg.message as Record<string, unknown> | undefined;
  const text: string =
    (message?.conversation as string) ||
    ((message?.extendedTextMessage as Record<string, unknown>)?.text as string) ||
    "";

  if (!text.trim()) return;

  const phone = remoteJid.split("@")[0];
  const pushName = (msg.pushName as string) ?? "";
  console.log(`[bot] ← ${phone} (${pushName}): "${text}"`);

  const convo = getOrCreateConversation(phone, pushName);
  insertMessage(convo.id, "user", text);

  const fresh = getConversationById(convo.id);
  if (!fresh || fresh.mode !== "AI") {
    console.log(`[bot] Conversación ${convo.id} en modo HUMAN, ignorando.`);
    return;
  }

  // ─── Identificación del empleado ──────────────────────────────────────────
  if (!fresh.naaloo_personal_id) {
    const reply = await identificarEmpleado(sock, remoteJid, convo.id, text);
    if (reply) {
      insertMessage(convo.id, "assistant", reply);
      await sock.sendMessage(remoteJid, { text: reply });
      console.log(`[bot] → ${phone}: "${reply.slice(0, 60)}"`);
    }
    return;
  }

  const empleado = {
    nombreCompleto: fresh.name ?? "Empleado",
    legajo: fresh.naaloo_legajo ?? "",
    personalId: fresh.naaloo_personal_id,
  };

  // ─── Flujo de pedido de insumos ───────────────────────────────────────────
  if (fresh.pending_action === "pedido_insumos") {
    const reply = await procesarPedidoInsumos(convo.id, text, empleado);
    insertMessage(convo.id, "assistant", reply);
    await sock.sendMessage(remoteJid, { text: reply });
    console.log(`[bot] → ${phone}: "${reply.slice(0, 60)}"`);
    return;
  }

  // Detecta si el empleado quiere hacer un pedido de insumos
  const quierePedido = /insumo|pedido|material|necesito pedir|solicitar/i.test(text);
  if (quierePedido) {
    setPendingAction(convo.id, "pedido_insumos");
    const reply = "Claro. Contame que insumos necesitas y los registro ahora.";
    insertMessage(convo.id, "assistant", reply);
    await sock.sendMessage(remoteJid, { text: reply });
    console.log(`[bot] → ${phone}: pedido de insumos iniciado`);
    return;
  }

  // ─── Respuesta con LLM + tools ────────────────────────────────────────────
  const history = getRecentHistory(convo.id, 20);
  console.log(`[bot] LLM (${history.length} mensajes, empleado=${empleado.nombreCompleto})`);

  const start = Date.now();
  const reply = await generateReply(history, empleado);
  console.log(`[bot] LLM respondió en ${Date.now() - start}ms`);

  if (!reply) return;

  insertMessage(convo.id, "assistant", reply);
  await sock.sendMessage(remoteJid, { text: reply });
  console.log(`[bot] → ${phone}: "${reply.slice(0, 60)}"`);
}

async function procesarPedidoInsumos(
  conversationId: number,
  texto: string,
  empleado: { nombreCompleto: string; legajo: string; personalId: number }
): Promise<string> {
  let interpretacion: { pedido: string } | { aclaracion: string };
  try {
    interpretacion = await interpretarPedidoInsumos(texto);
  } catch (err) {
    console.error("[pedidos] Error interpretando pedido:", err);
    return "Tuve un problema entendiendo el pedido. Intenta de nuevo en unos minutos.";
  }

  if ("aclaracion" in interpretacion) {
    // Seguimos esperando un pedido claro, no tocamos pending_action
    return interpretacion.aclaracion;
  }

  setPendingAction(conversationId, null);

  try {
    // Intentamos obtener el área del empleado desde Naaloo
    let area = "";
    try {
      const datos = await getEmpleadoPorId(empleado.personalId);
      area = datos.area || datos.oficinaNombre || "";
    } catch { /* no bloqueante */ }

    guardarPedido({
      nombre: empleado.nombreCompleto,
      legajo: empleado.legajo,
      area,
      pedido: interpretacion.pedido,
    });

    console.log(`[pedidos] Guardado pedido de ${empleado.nombreCompleto}: "${interpretacion.pedido.slice(0, 60)}"`);
    return `Listo, registre tu pedido: "${interpretacion.pedido}". La secretaria lo va a revisar a la brevedad.\n\n¿Hay algo mas en lo que te pueda ayudar?`;
  } catch (err) {
    console.error("[pedidos] Error guardando pedido:", err);
    return "No pude guardar el pedido en este momento. Intenta de nuevo o contacta a la secretaria directamente.";
  }
}

async function identificarEmpleado(
  sock: Sock,
  remoteJid: string,
  conversationId: number,
  text: string
): Promise<string> {
  const trimmed = text.trim();

  // Si el mensaje es muy corto (una sola palabra o menos de 4 chars) pedimos el nombre
  const pareceNombre = trimmed.length >= 4 && trimmed.includes(" ");
  if (!pareceNombre) {
    return MSG_BIENVENIDA;
  }

  try {
    const empleado = await getEmpleadoPorNombre(trimmed);
    if (!empleado?.personalId) {
      return MSG_NOMBRE_NO_ENCONTRADO;
    }

    setNaalooEmployee(conversationId, empleado.personalId, empleado.legajo);

    const db = await import("../db");
    db.default
      .prepare("UPDATE conversations SET name = ? WHERE id = ?")
      .run(empleado.nombreCompleto, conversationId);

    console.log(`[bot] Empleado identificado: ${empleado.nombreCompleto} (ID ${empleado.personalId})`);
    return MSG_IDENTIFICADO(empleado.nombre);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[bot] Error buscando empleado:", msg);
    return MSG_NOMBRE_ERROR;
  }
}
