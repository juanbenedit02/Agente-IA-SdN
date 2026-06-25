import { NextResponse } from "next/server";
import { setConnectionState } from "@/lib/db";
import path from "node:path";
import fs from "node:fs";

export async function POST() {
  setConnectionState({ status: "disconnected", qr_string: null, phone: null });

  const authDir = path.resolve(process.cwd(), "auth");
  fs.rmSync(authDir, { recursive: true, force: true });

  // señal para que el proceso bot reinicie limpio
  const restartFlag = path.resolve(process.cwd(), "data", ".restart");
  fs.mkdirSync(path.dirname(restartFlag), { recursive: true });
  fs.writeFileSync(restartFlag, "");

  return NextResponse.json({ ok: true });
}
