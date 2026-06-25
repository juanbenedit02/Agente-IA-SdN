// Horarios esperados de entrada/salida por oficina, usados para calcular llegadas tarde.

interface Horario {
  entrada: string; // "HH:MM"
  salida: string;
}

// Índice 0 = domingo ... 6 = sábado (igual que Date.getDay())
type HorarioSemana = (Horario | null)[];

const DEFAULT_HORARIO: Horario = { entrada: "08:00", salida: "17:00" };
const SABADO_REDUCIDO: Horario = { entrada: "08:00", salida: "12:00" };

const HORARIO_DEFAULT: HorarioSemana = [
  null,
  DEFAULT_HORARIO,
  DEFAULT_HORARIO,
  DEFAULT_HORARIO,
  DEFAULT_HORARIO,
  DEFAULT_HORARIO,
  SABADO_REDUCIDO,
];

const HORARIOS_POR_OFICINA: Record<string, HorarioSemana> = {
  POLO: [
    null,
    { entrada: "07:00", salida: "17:00" }, // lunes
    { entrada: "07:00", salida: "17:00" }, // martes
    { entrada: "07:00", salida: "17:00" }, // miércoles
    { entrada: "07:00", salida: "17:00" }, // jueves
    { entrada: "07:00", salida: "16:00" }, // viernes
    null, // sábado: no trabaja
  ],
  "SCJ PILAR": [
    null,
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "11:00" }, // sábado
  ],
  ALMAHUE: [
    null,
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "16:00" },
    SABADO_REDUCIDO,
  ],
  "LOS CARDOS": [
    null,
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "16:00" },
    { entrada: "07:00", salida: "16:00" },
    SABADO_REDUCIDO,
  ],
};

function normalizarOficina(nombre: string): string {
  return nombre
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function getHorarioEsperado(oficinaNombre: string, fecha: Date): Horario | null {
  const clave = normalizarOficina(oficinaNombre);
  const semana = HORARIOS_POR_OFICINA[clave] ?? HORARIO_DEFAULT;
  return semana[fecha.getDay()];
}

// fechaIngresoISO viene de Naaloo como "YYYY-MM-DDTHH:MM:SS..." en hora local.
// Comparamos como texto para no arrastrar problemas de timezone.
export function esLlegadaTarde(oficinaNombre: string, fechaIngresoISO: string): boolean {
  const fechaParte = fechaIngresoISO.slice(0, 10);
  const horaParte = fechaIngresoISO.slice(11, 16);
  if (!fechaParte || !horaParte) return false;

  const fecha = new Date(`${fechaParte}T00:00:00`);
  const horario = getHorarioEsperado(oficinaNombre, fecha);
  if (!horario) return false;

  return horaParte > horario.entrada;
}
