import fs from "node:fs";
import path from "node:path";

const PEDIDOS_PATH = path.resolve(process.cwd(), "data", "pedidos.csv");
const HEADER = "Fecha,Nombre,Legajo,Area,Pedido\n";

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function guardarPedido(datos: {
  nombre: string;
  legajo: string;
  area: string;
  pedido: string;
}): void {
  if (!fs.existsSync(PEDIDOS_PATH)) {
    fs.writeFileSync(PEDIDOS_PATH, HEADER, "utf8");
  }

  const fecha = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const fila = [
    escapeCsv(fecha),
    escapeCsv(datos.nombre),
    escapeCsv(datos.legajo),
    escapeCsv(datos.area),
    escapeCsv(datos.pedido),
  ].join(",") + "\n";

  fs.appendFileSync(PEDIDOS_PATH, fila, "utf8");
}
