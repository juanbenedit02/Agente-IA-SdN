// Cliente para la API de Naaloo (backend.naaloo.com)

const BASE_URL = "https://backend.naaloo.com";

function getHeaders(): Record<string, string> {
  const token = process.env.NAALOO_API_TOKEN;
  if (!token) throw new Error("NAALOO_API_TOKEN no está definida en .env.local");
  return {
    Authorization: token,
    "Accept": "application/json",
    "X-Client-Version": "2.81.000",
  };
}

async function naalooFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), { headers: getHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Naaloo ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ─── Tipos básicos ────────────────────────────────────────────────────────────

export interface EmpleadoBasico {
  id: number;
  nombre: string;
  apellido: string;
  nombreCompleto: string;
  legajo: string;
  legajoId: number;
  cargo: string;
  area: string;
  sector: string;
  email: string;
  companyEmail: string;
  telefonos: string;
  fechaIngreso: string;
  activo: boolean;
  antiguedad: number;
  cuil: string;
  dni: string;
  oficinaNombre: string;
}

export interface EmpleadoLegajo {
  id: number;          // legajo ID
  personalId: number;  // ID de personal (para queries)
  nombre: string;
  apellido: string;
  nombreCompleto: string;
  legajo: string;
  email: string;
  companyEmail: string;
  telefonos: string;
  positionName: string;
  isActive: boolean;
  cuil: string;
  dni: string;
  oficinaNombre: string;
}

export interface Ausencia {
  id: number;
  fechaDesde: string;
  fechaHasta: string;
  descripcion: string;
  estado: string;
  isVacation: boolean;
  ausencia: { nombre?: string; descripcion?: string; cantUnidades?: number };
  personalLegajo: { personalId: number; nombreCompleto: string; legajo: string };
}

export interface Fichaje {
  id: number;
  fechaIngreso: string;
  fechaSalida: string;
  horasTrabajadas: string;
  estadoFichaje: string;
  personalLegajo: { personalId: number; nombreCompleto: string; legajo: string };
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

export async function getEmpleadoPorLegajo(legajo: string): Promise<EmpleadoLegajo> {
  return naalooFetch<EmpleadoLegajo>(`/personalLegajos/legajo/${encodeURIComponent(legajo)}`);
}

export async function getEmpleadoPorId(id: number): Promise<EmpleadoBasico> {
  // /personal/{ID} devuelve PersonalDTO (más completo), lo casteamos a lo que necesitamos
  const data = await naalooFetch<Record<string, unknown>>(`/personal/${id}`);
  const legajoObj = data.legajo as Record<string, unknown> | undefined;
  const fechaIngreso = (legajoObj?.fechaIngreso as string) ?? "";
  return {
    id: data.id as number,
    nombre: data.nombre as string,
    apellido: data.apellido as string,
    nombreCompleto: data.nombreCompleto as string,
    legajo: (legajoObj?.legajo as string) ?? "",
    legajoId: (legajoObj?.id as number) ?? 0,
    cargo: (legajoObj?.positionName as string) ?? "",
    area: data.oficinaNombre as string ?? "",
    sector: "",
    email: data.email as string ?? "",
    companyEmail: data.companyEmail as string ?? "",
    telefonos: data.telefonos as string ?? "",
    fechaIngreso,
    activo: true,
    antiguedad: fechaIngreso ? calcularAntiguedadAnios(fechaIngreso) : 0,
    cuil: data.cuil as string ?? "",
    dni: data.dni as string ?? "",
    oficinaNombre: data.oficinaNombre as string ?? "",
  };
}

function calcularAntiguedadAnios(fechaIngreso: string): number {
  const ingreso = new Date(fechaIngreso).getTime();
  const ahora = Date.now();
  return Math.floor((ahora - ingreso) / (365.25 * 86400000));
}

export async function getAusencias(params?: {
  fechaDesde?: string;
  fechaHasta?: string;
  pageSize?: number;
}): Promise<Ausencia[]> {
  const query: Record<string, string> = {};
  if (params?.fechaDesde) query.fechaDesde = params.fechaDesde;
  if (params?.fechaHasta) query.fechaHasta = params.fechaHasta;
  if (params?.pageSize) query.pageSize = String(params.pageSize);
  const data = await naalooFetch<{ data?: Ausencia[] }>("/ausencias/personal/filtradas", query);
  return data.data ?? (data as unknown as Ausencia[]);
}

export async function getFichajes(params?: {
  fechaDesde?: string;
  fechaHasta?: string;
  pageSize?: number;
}): Promise<Fichaje[]> {
  const query: Record<string, string> = {};
  if (params?.fechaDesde) query.fechaDesde = params.fechaDesde;
  if (params?.fechaHasta) query.fechaHasta = params.fechaHasta;
  if (params?.pageSize) query.pageSize = String(params.pageSize);
  const data = await naalooFetch<{ data?: Fichaje[] }>("/fichajes/", query);
  return data.data ?? (data as unknown as Fichaje[]);
}

export async function getListaLegajos(): Promise<EmpleadoLegajo[]> {
  const data = await naalooFetch<{ data?: EmpleadoLegajo[] }>("/personalLegajos/");
  return data.data ?? (data as unknown as EmpleadoLegajo[]);
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export async function getEmpleadoPorNombre(
  nombreBuscado: string
): Promise<EmpleadoLegajo | null> {
  const lista = await getListaLegajos();
  const palabrasBuscadas = normalizar(nombreBuscado).split(/\s+/).filter(Boolean);

  const coincidencias = lista.filter((e) => {
    const nombreNorm = normalizar(e.nombreCompleto);
    return palabrasBuscadas.every((p) => nombreNorm.includes(p));
  });

  // Solo identificamos si hay exactamente una coincidencia para evitar ambigüedad
  if (coincidencias.length === 1) return coincidencias[0];
  return null;
}

export async function getListaEmpleados(pageSize = 200): Promise<EmpleadoBasico[]> {
  const data = await naalooFetch<{ data?: EmpleadoBasico[] }>("/personal/", {
    pageSize: String(pageSize),
  });
  return data.data ?? (data as unknown as EmpleadoBasico[]);
}
