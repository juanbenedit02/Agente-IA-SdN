import OpenAI from "openai";
import { SYSTEM_PROMPT, buildSystemPromptWithEmployee } from "./system-prompt";
import { getAusencias, getFichajes, getEmpleadoPorId } from "./naaloo";
import type { Message } from "./db";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY no está definida");
    _client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }
  return _client;
}

// ─── Herramientas disponibles para el LLM ────────────────────────────────────

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "consultar_ausencias",
      description: "Consulta las ausencias registradas del empleado en un período. Devuelve licencias, vacaciones y ausencias.",
      parameters: {
        type: "object",
        properties: {
          fechaDesde: {
            type: "string",
            description: "Fecha desde en formato YYYY-MM-DD. Si no se especifica, usa hace 90 días.",
          },
          fechaHasta: {
            type: "string",
            description: "Fecha hasta en formato YYYY-MM-DD. Si no se especifica, usa hoy.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_fichajes",
      description: "Consulta los registros de ingreso y egreso del empleado (fichajes/asistencia).",
      parameters: {
        type: "object",
        properties: {
          fechaDesde: {
            type: "string",
            description: "Fecha desde en formato YYYY-MM-DD.",
          },
          fechaHasta: {
            type: "string",
            description: "Fecha hasta en formato YYYY-MM-DD.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_saldo_vacaciones",
      description: "Calcula una ESTIMACIÓN de los días de vacaciones que le quedan al empleado (días corridos según antigüedad menos los ya tomados en el último año). Usar esta herramienta para cualquier pregunta sobre saldo, días restantes o cuántas vacaciones le quedan — no intentes calcularlo a mano con consultar_ausencias.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_datos_empleado",
      description: "Consulta los datos completos del empleado: cargo, área, email corporativo, teléfono, fecha de ingreso.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// ─── Cálculo de vacaciones (LCT Argentina, art. 150) ──────────────────────────

function diasVacacionesPorAntiguedad(antiguedadAnios: number): number {
  if (antiguedadAnios < 5) return 14;
  if (antiguedadAnios < 10) return 21;
  if (antiguedadAnios < 20) return 28;
  return 35;
}

// ─── Ejecución de herramientas ────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, string>,
  personalId: number
): Promise<string> {
  try {
    if (name === "consultar_ausencias") {
      const hoy = new Date().toISOString().slice(0, 10);
      const hace90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const ausencias = await getAusencias({
        fechaDesde: args.fechaDesde ?? hace90,
        fechaHasta: args.fechaHasta ?? hoy,
        pageSize: 100,
      });
      const propias = ausencias.filter(
        (a) => a.personalLegajo?.personalId === personalId
      );
      if (propias.length === 0) return "Sin ausencias registradas en el período.";
      return propias
        .map((a) => {
          const tipo = a.ausencia?.nombre ?? (a.isVacation ? "Vacaciones" : "Ausencia");
          return `${tipo}: ${a.fechaDesde} → ${a.fechaHasta} (${a.estado})`;
        })
        .join("\n");
    }

    if (name === "consultar_fichajes") {
      const hoy = new Date().toISOString().slice(0, 10);
      const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const fichajes = await getFichajes({
        fechaDesde: args.fechaDesde ?? hace30,
        fechaHasta: args.fechaHasta ?? hoy,
        pageSize: 50,
      });
      const propios = fichajes.filter(
        (f) => f.personalLegajo?.personalId === personalId
      );
      if (propios.length === 0) return "Sin fichajes registrados en el período.";
      return propios
        .map(
          (f) =>
            `${f.fechaIngreso?.slice(0, 10)}: ingreso ${f.fechaIngreso?.slice(11, 16)} — egreso ${f.fechaSalida?.slice(11, 16) ?? "sin registrar"} (${f.horasTrabajadas ?? "-"} hs)`
        )
        .join("\n");
    }

    if (name === "consultar_saldo_vacaciones") {
      const emp = await getEmpleadoPorId(personalId);
      if (!emp.fechaIngreso) {
        return "No tengo registrada tu fecha de ingreso, así que no puedo estimar tu saldo de vacaciones. Consultá a la secretaria.";
      }

      const diasCorridos = diasVacacionesPorAntiguedad(emp.antiguedad);

      const hoy = new Date();
      const haceUnAnio = new Date(hoy);
      haceUnAnio.setFullYear(haceUnAnio.getFullYear() - 1);
      const ausencias = await getAusencias({
        fechaDesde: haceUnAnio.toISOString().slice(0, 10),
        fechaHasta: hoy.toISOString().slice(0, 10),
        pageSize: 200,
      });

      const tomadas = ausencias.filter(
        (a) =>
          a.personalLegajo?.personalId === personalId &&
          a.isVacation &&
          new Date(a.fechaHasta) < hoy
      );
      const diasTomados = tomadas.reduce((acc, a) => {
        const desde = new Date(a.fechaDesde).getTime();
        const hasta = new Date(a.fechaHasta).getTime();
        return acc + Math.round((hasta - desde) / 86400000) + 1;
      }, 0);

      const restantes = Math.max(diasCorridos - diasTomados, 0);
      return (
        `Según tu antigüedad (~${emp.antiguedad} años) te corresponden ${diasCorridos} días corridos de vacaciones por ciclo. ` +
        `Ya tomaste ${diasTomados} días en el último año. Saldo estimado: ${restantes} días.\n\n` +
        `Esto es una estimación: Naaloo no expone el saldo calculado directamente, así que para el número exacto conviene confirmar con la secretaria.`
      );
    }

    if (name === "consultar_datos_empleado") {
      const emp = await getEmpleadoPorId(personalId);
      return [
        `Nombre: ${emp.nombreCompleto}`,
        `Cargo: ${emp.cargo || "-"}`,
        `Área: ${emp.area || emp.oficinaNombre || "-"}`,
        `Email: ${emp.companyEmail || emp.email || "-"}`,
        `Teléfono: ${emp.telefonos || "-"}`,
        `Fecha ingreso: ${emp.fechaIngreso || "-"}`,
        `CUIL: ${emp.cuil || "-"}`,
      ].join("\n");
    }

    return "Herramienta no reconocida.";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[naaloo] Error en tool ${name}:`, msg);
    return `No pude obtener la información en este momento. (${msg.slice(0, 100)})`;
  }
}

// ─── Interpretación de pedidos de insumos ─────────────────────────────────────

export async function interpretarPedidoInsumos(
  texto: string
): Promise<{ pedido: string } | { aclaracion: string }> {
  const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const client = getClient();

  const response = await client.chat.completions.create({
    model,
    max_tokens: 150,
    messages: [
      {
        role: "system",
        content:
          "Analizá el mensaje de un empleado que está pidiendo insumos de trabajo (materiales, herramientas, indumentaria, etc). " +
          "Si el mensaje describe claramente qué insumos necesita, respondé exactamente: PEDIDO: <resumen breve y claro del pedido>. " +
          "Si el mensaje no deja en claro qué insumos necesita (dice que no sabe, pregunta algo, es ambiguo, o no tiene nada que ver con un pedido), " +
          "respondé exactamente: ACLARACION: <una pregunta corta y concreta para saber qué insumos necesita>.",
      },
      { role: "user", content: texto },
    ],
  });

  const content = response.choices[0]?.message?.content?.trim() ?? "";
  if (content.startsWith("PEDIDO:")) {
    return { pedido: content.slice("PEDIDO:".length).trim() };
  }
  if (content.startsWith("ACLARACION:")) {
    return { aclaracion: content.slice("ACLARACION:".length).trim() };
  }
  return { aclaracion: "¿Qué insumos necesitas? Contame con el mayor detalle posible." };
}

// ─── Generación de respuesta ──────────────────────────────────────────────────

export async function generateReply(
  history: Message[],
  empleado?: { nombreCompleto: string; legajo: string; personalId: number } | null
): Promise<string> {
  const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const client = getClient();

  const systemContent = empleado
    ? buildSystemPromptWithEmployee(empleado)
    : SYSTEM_PROMPT;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = history.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  // Si no hay empleado identificado, respondemos sin tools
  const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: [{ role: "system", content: systemContent }, ...messages],
    max_tokens: 400,
    ...(empleado ? { tools: TOOLS, tool_choice: "auto" } : {}),
  };

  let response = await client.chat.completions.create(requestParams);
  let choice = response.choices[0];

  // Bucle de tool calling (máximo 3 rondas para evitar loops)
  let rounds = 0;
  while (choice.finish_reason === "tool_calls" && choice.message.tool_calls && rounds < 3) {
    rounds++;
    const assistantMsg = choice.message;
    const toolMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [assistantMsg];

    for (const toolCall of assistantMsg.tool_calls!) {
      const args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, string>;
      const result = await executeTool(toolCall.function.name, args, empleado!.personalId);
      console.log(`[llm] Tool ${toolCall.function.name} → ${result.slice(0, 80)}`);
      toolMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    response = await client.chat.completions.create({
      ...requestParams,
      messages: [
        { role: "system", content: systemContent },
        ...messages,
        ...toolMessages,
      ],
    });
    choice = response.choices[0];
  }

  return choice.message?.content?.trim() ?? "";
}
