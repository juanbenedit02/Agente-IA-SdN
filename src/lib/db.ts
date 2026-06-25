import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = path.resolve(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "messages.db");
const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    mode TEXT CHECK(mode IN ('AI','HUMAN')) NOT NULL DEFAULT 'AI',
    naaloo_personal_id INTEGER,
    naaloo_legajo TEXT,
    pending_action TEXT,
    last_message_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    role TEXT CHECK(role IN ('user','assistant','human')) NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv
    ON messages(conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS connection_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT CHECK(status IN ('disconnected','qr','connecting','connected'))
      NOT NULL DEFAULT 'disconnected',
    qr_string TEXT,
    phone TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  INSERT OR IGNORE INTO connection_state (id, status) VALUES (1, 'disconnected');

  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    content TEXT NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox(sent, created_at);
`);

// Migración: agrega columnas si la tabla ya existía sin ellas
try { db.exec("ALTER TABLE conversations ADD COLUMN naaloo_personal_id INTEGER"); } catch { /* ya existe */ }
try { db.exec("ALTER TABLE conversations ADD COLUMN naaloo_legajo TEXT"); } catch { /* ya existe */ }
try { db.exec("ALTER TABLE conversations ADD COLUMN pending_action TEXT"); } catch { /* ya existe */ }

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface Conversation {
  id: number;
  phone: string;
  name: string | null;
  mode: "AI" | "HUMAN";
  naaloo_personal_id: number | null;
  naaloo_legajo: string | null;
  pending_action: string | null;
  last_message_at: number | null;
  created_at: number;
}

export interface ConversationWithPreview extends Conversation {
  last_message_preview: string | null;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "assistant" | "human";
  content: string;
  created_at: number;
}

export interface ConnectionState {
  id: 1;
  status: "disconnected" | "qr" | "connecting" | "connected";
  qr_string: string | null;
  phone: string | null;
  updated_at: number;
}

export interface OutboxItem {
  id: number;
  conversation_id: number;
  phone: string;
  content: string;
  sent: number;
  created_at: number;
}

// ─── Helper de transacción ────────────────────────────────────────────────────

function withTransaction<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ─── Conversaciones ───────────────────────────────────────────────────────────

export function getOrCreateConversation(
  phone: string,
  name?: string | null
): Conversation {
  const existing = db
    .prepare("SELECT * FROM conversations WHERE phone = ?")
    .get(phone) as unknown as Conversation | undefined;

  if (existing) {
    if (name && (!existing.name || existing.name === "")) {
      db.prepare(
        "UPDATE conversations SET name = ? WHERE phone = ? AND (name IS NULL OR name = '')"
      ).run(name, phone);
      return { ...existing, name };
    }
    return existing;
  }

  db.prepare(
    "INSERT OR IGNORE INTO conversations (phone, name) VALUES (?, ?)"
  ).run(phone, name ?? null);

  return db
    .prepare("SELECT * FROM conversations WHERE phone = ?")
    .get(phone) as unknown as Conversation;
}

export function getConversationById(id: number): Conversation | null {
  return (
    (db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as unknown as Conversation | undefined) ?? null
  );
}

export function listConversations(): ConversationWithPreview[] {
  return db
    .prepare(
      `SELECT c.*,
        (SELECT content FROM messages m
         WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview
       FROM conversations c
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`
    )
    .all() as unknown as ConversationWithPreview[];
}

export function setMode(conversationId: number, mode: "AI" | "HUMAN"): void {
  db.prepare("UPDATE conversations SET mode = ? WHERE id = ?").run(
    mode,
    conversationId
  );
}

export function setPendingAction(
  conversationId: number,
  action: string | null
): void {
  db.prepare(
    "UPDATE conversations SET pending_action = ? WHERE id = ?"
  ).run(action, conversationId);
}

export function setNaalooEmployee(
  conversationId: number,
  personalId: number,
  legajo: string
): void {
  db.prepare(
    "UPDATE conversations SET naaloo_personal_id = ?, naaloo_legajo = ? WHERE id = ?"
  ).run(personalId, legajo, conversationId);
}

export function deleteConversation(id: number): void {
  withTransaction(() => {
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    db.prepare(
      "DELETE FROM outbox WHERE conversation_id = ? AND sent = 0"
    ).run(id);
    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  });
}

// ─── Mensajes ─────────────────────────────────────────────────────────────────

export function insertMessage(
  conversationId: number,
  role: Message["role"],
  content: string
): void {
  withTransaction(() => {
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)"
    ).run(conversationId, role, content);
    db.prepare(
      "UPDATE conversations SET last_message_at = unixepoch() WHERE id = ?"
    ).run(conversationId);
  });
}

export function getMessages(conversationId: number, limit = 50): Message[] {
  return db
    .prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?"
    )
    .all(conversationId, limit) as unknown as Message[];
}

export function getRecentHistory(
  conversationId: number,
  limit = 20
): Message[] {
  const rows = db
    .prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(conversationId, limit) as unknown as Message[];
  return rows.reverse();
}

// ─── Estado de conexión ───────────────────────────────────────────────────────

export function getConnectionState(): ConnectionState {
  return db
    .prepare("SELECT * FROM connection_state WHERE id = 1")
    .get() as unknown as ConnectionState;
}

export function setConnectionState(patch: {
  status?: ConnectionState["status"];
  qr_string?: string | null;
  phone?: string | null;
}): void {
  const current = getConnectionState();

  const status = patch.status ?? current.status;
  const qr_string = "qr_string" in patch ? patch.qr_string : current.qr_string;
  const phone = "phone" in patch ? patch.phone : current.phone;

  db.prepare(
    `UPDATE connection_state
     SET status = ?, qr_string = ?, phone = ?, updated_at = unixepoch()
     WHERE id = 1`
  ).run(status, qr_string ?? null, phone ?? null);
}

// ─── Outbox ───────────────────────────────────────────────────────────────────

export function enqueueOutbox(
  conversationId: number,
  phone: string,
  content: string
): void {
  db.prepare(
    "INSERT INTO outbox (conversation_id, phone, content) VALUES (?, ?, ?)"
  ).run(conversationId, phone, content);
}

export function getPendingOutbox(limit = 20): OutboxItem[] {
  return db
    .prepare(
      "SELECT * FROM outbox WHERE sent = 0 ORDER BY created_at ASC LIMIT ?"
    )
    .all(limit) as unknown as OutboxItem[];
}

export function markOutboxSent(id: number): void {
  db.prepare("UPDATE outbox SET sent = 1 WHERE id = ?").run(id);
}

export default db;
