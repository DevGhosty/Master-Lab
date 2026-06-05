import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { SESSION_TTL_MS } from "./constants.js";

/** @type {Map<string, { path: string, originalExt: string, createdAt: number }>} */
const sessions = new Map();

export function createUploadSession(filePath, originalExt = ".wav") {
  const id = randomUUID();
  sessions.set(id, {
    path: filePath,
    originalExt,
    createdAt: Date.now(),
  });
  return id;
}

export function getUploadSession(id) {
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    releaseUploadSession(id).catch(() => {});
    return null;
  }
  return session;
}

export async function releaseUploadSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  await fs.unlink(session.path).catch(() => {});
}

export function scheduleSessionCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        releaseUploadSession(id).catch(() => {});
      }
    }
  }, 60_000);
}
