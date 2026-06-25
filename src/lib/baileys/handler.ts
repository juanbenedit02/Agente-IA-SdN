import type makeWASocket from "@whiskeysockets/baileys";
import type { BaileysEventMap } from "@whiskeysockets/baileys";
import {
  getOrCreateConversation,
  insertMessage,
  getConversationById,
  getRecentHistory,
  setNaalooEmployee,
  setPendingAction,
  setMode,
} from "../db";
import { generateReply, interpretarPedidoInsumos } from "../openrouter";
import { getEmpleadoPorDni, getEmpleadoPorId, getAusencias, getFichajes } from "../naaloo";
import { guardarPedido } from "../pedidos";
import { esLlegadaTarde } from "../horarios";

type Sock = ReturnType<typeof makeWASocket>;
type UpsertEvent = BaileysEventMap["messages.upsert"];

const MSG_BIENVENIDA =
  "Hola, soy el asistente de RRHH de Suelos del Norte. Para comenzar necesito tu numero de DNI (sin puntos). Enviamelo y te identifico enseguida.";

const MSG_DNI_NO_ENCONTRADO =
  "No encontre ningun empleado con ese DNI. Fijate de escribirlo bien, sin puntos ni espacios.";

const MSG_DNI_ERROR =
  "Tuve un problema al buscarte. Intenta de nuevo en unos minutos.";

const MENU =
  "En que te puedo ayudar? Podes consultarme sobre:\n\n" +
  "- Por que no me pagaron el presentismo\n" +
  "- Mis faltas y permisos\n" +
  "- Mis horarios (cuando entre y cuando sali)\n" +
  "- Mis datos (numero de empleado, area, email, etc)\n" +
  "- Mis vacaciones\n" +
  "- Pedido de materiales o herramientas\n" +
  "- Hablar con la secretaria\n\n" +
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

  // ─── Flujo de presentismo ──────────────────────────────────────────────────
  if (fresh.pending_action === "presentismo_mes") {
    const mes = parseMesElegido(text);
    if (!mes) {
      const reply = "No te entendi. Decime: el mes actual o el mes anterior?";
      insertMessage(convo.id, "assistant", reply);
      await sock.sendMessage(remoteJid, { text: reply });
      console.log(`[bot] → ${phone}: "${reply.slice(0, 60)}"`);
      return;
    }
    setPendingAction(convo.id, null);
    const reply = await procesarPresentismo(mes, empleado.personalId);
    insertMessage(convo.id, "assistant", reply);
    await sock.sendMessage(remoteJid, { text: reply });
    console.log(`[bot] → ${phone}: "${reply.slice(0, 60)}"`);
    return;
  }

  // Detecta si el empleado pregunta por el presentismo
  const quierePresentismo = /presentismo|premio.*asisten|plus.*asisten/i.test(text);
  if (quierePresentismo) {
    setPendingAction(convo.id, "presentismo_mes");
    const reply = "Te puedo decir si tenes faltas en el mes. Queres ver el mes actual o el mes anterior?";
    insertMessage(convo.id, "assistant", reply);
    await sock.sendMessage(remoteJid, { text: reply });
    console.log(`[bot] → ${phone}: presentismo iniciado`);
    return;
  }

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
  const { reply, derivedToHuman } = await generateReply(history, empleado);
  console.log(`[bot] LLM respondió en ${Date.now() - start}ms`);

  if (!reply) return;

  insertMessage(convo.id, "assistant", reply);
  await sock.sendMessage(remoteJid, { text: reply });
  console.log(`[bot] → ${phone}: "${reply.slice(0, 60)}"`);

  if (derivedToHuman) {
    setMode(convo.id, "HUMAN");
    console.log(`[bot] Conversación ${convo.id} derivada a HUMAN (secretaria)`);
  }
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

function parseMesElegido(text: string): "actual" | "anterior" | null {
  const t = text.toLowerCase();
  if (/anterior|pasado/.test(t)) return "anterior";
  if (/actual|corriente|este mes/.test(t)) return "actual";
  return null;
}

const NOMBRES_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function rangoMes(mes: "actual" | "anterior"): {
  desde: string;
  hasta: string;
  etiqueta: string;
} {
  const hoy = new Date();
  let anio = hoy.getFullYear();
  let mesIndex = hoy.getMonth();

  if (mes === "anterior") {
    mesIndex -= 1;
    if (mesIndex < 0) {
      mesIndex = 11;
      anio -= 1;
    }
  }

  const desde = new Date(anio, mesIndex, 1);
  const hasta = mes === "actual" ? hoy : new Date(anio, mesIndex + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return { desde: fmt(desde), hasta: fmt(hasta), etiqueta: NOMBRES_MES[mesIndex] };
}

async function procesarPresentismo(
  mes: "actual" | "anterior",
  personalId: number
): Promise<string> {
  const { desde, hasta, etiqueta } = rangoMes(mes);

  try {
    const [ausencias, fichajes, empleado] = await Promise.all([
      getAusencias({ fechaDesde: desde, fechaHasta: hasta, pageSize: 100 }),
      getFichajes({ fechaDesde: desde, fechaHasta: hasta, pageSize: 100 }),
      getEmpleadoPorId(personalId).catch(() => null),
    ]);

    const faltas = ausencias.filter(
      (a) => a.personalLegajo?.personalId === personalId && !a.isVacation
    );

    const lineas: string[] = [`Te paso lo de ${etiqueta}:`];

    if (faltas.length === 0) {
      lineas.push("- No tenes faltas registradas.");
    } else {
      lineas.push(`- Tenes ${faltas.length} falta(s):`);
      for (const f of faltas) {
        const tipo = f.ausencia?.nombre ?? "Falta";
        lineas.push(`  • ${tipo}: ${f.fechaDesde} a ${f.fechaHasta}`);
      }
    }

    const oficina = empleado?.oficinaNombre ?? "";
    if (!oficina) {
      lineas.push("- Llegadas tarde: no tengo cargada tu oficina, no puedo calcularlo. Hablalo con la secretaria.");
    } else {
      const propios = fichajes.filter((f) => f.personalLegajo?.personalId === personalId);
      const tarde = propios.filter((f) => f.fechaIngreso && esLlegadaTarde(oficina, f.fechaIngreso));

      if (tarde.length === 0) {
        lineas.push("- No llegaste tarde ningun dia.");
      } else {
        lineas.push(`- Llegaste tarde ${tarde.length} dia(s):`);
        for (const f of tarde) {
          lineas.push(`  • ${f.fechaIngreso.slice(0, 10)}: entraste a las ${f.fechaIngreso.slice(11, 16)}`);
        }
      }
    }

    lineas.push("");
    lineas.push("Si tenes dudas sobre el presentismo, hablalo con la secretaria.");

    return lineas.join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[presentismo] Error consultando faltas:", msg);
    return "No pude consultar tus faltas en este momento. Intenta de nuevo en unos minutos.";
  }
}

async function identificarEmpleado(
  sock: Sock,
  remoteJid: string,
  conversationId: number,
  text: string
): Promise<string> {
  const soloDigitos = text.replace(/\D/g, "");

  // DNI argentino: 7 u 8 dígitos
  const pareceDni = soloDigitos.length >= 7 && soloDigitos.length <= 8;
  if (!pareceDni) {
    return MSG_BIENVENIDA;
  }

  try {
    const empleado = await getEmpleadoPorDni(soloDigitos);
    if (!empleado?.personalId) {
      return MSG_DNI_NO_ENCONTRADO;
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
    return MSG_DNI_ERROR;
  }
}
