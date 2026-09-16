import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { pgClient } from '../db/index.js'

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.resolve(process.cwd(), 'uploads')
const PUBLIC_BASE = process.env.STORAGE_PUBLIC_URL || '/storage'

export interface StoredFile {
  name: string
  path: string
  size: number
  contentType: string
  publicUrl: string
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain', '.json': 'application/json',
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._\-/]/g, '_')
  return cleaned.replace(/^\/+/, '').replace(/\/+/g, '/')
}

function resolvePath(bucket: string, name: string): string {
  const b = safeName(bucket)
  // Drop any traversal segments instead of throwing (a thrown Error surfaces as HTTP 500).
  const n = safeName(name)
    .split('/')
    .filter((seg) => seg !== '..')
    .join('/')
    .replace(/\/+/g, '/')
  return path.join(STORAGE_ROOT, b, n)
}

export async function ensureBucket(bucket: string): Promise<void> {
  const b = safeName(bucket)
  await mkdir(path.join(STORAGE_ROOT, b), { recursive: true })
}

// ─── Postgres-backed persistence ───

async function dbSave(bucket: string, name: string, data: Buffer, contentType: string): Promise<void> {
  try {
    await pgClient`
      INSERT INTO stored_files (bucket, name, data, content_type, size)
      VALUES (${bucket}, ${name}, ${data}, ${contentType}, ${data.length})
      ON CONFLICT (bucket, name)
      DO UPDATE SET data = EXCLUDED.data, content_type = EXCLUDED.content_type, size = EXCLUDED.size
    `
  } catch (e) {
    // DB write must never break an upload — keep the disk copy as fallback.
    console.error(`[storage] DB write failed for ${bucket}/${name}:`, (e as Error)?.message)
  }
}

async function dbGet(bucket: string, name: string): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const rows = await pgClient<{ data: Buffer; content_type: string }[]>`
      SELECT data, content_type FROM stored_files WHERE bucket = ${bucket} AND name = ${name}
    `
    const row = rows[0]
    if (!row) return null
    return { data: Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data), contentType: row.content_type }
  } catch {
    return null
  }
}

async function dbDelete(bucket: string, name: string): Promise<void> {
  try {
    await pgClient`DELETE FROM stored_files WHERE bucket = ${bucket} AND name = ${name}`
  } catch {
    // best effort
  }
}

async function dbList(bucket: string, folder?: string): Promise<StoredFile[]> {
  try {
    const prefix = folder ? `${safeName(folder).replace(/\/+$/, '')}/` : ''
    const rows = await pgClient<{ name: string; content_type: string; size: number }[]>`
      SELECT name, content_type, size FROM stored_files
      WHERE bucket = ${bucket} ${prefix ? pgClient`AND name LIKE ${prefix + '%'}` : pgClient``}
      ORDER BY name
    `
    return rows.map((r) => ({
      name: r.name,
      path: `/${bucket}/${r.name}`,
      size: Number(r.size),
      contentType: r.content_type,
      publicUrl: `${PUBLIC_BASE}/${bucket}/${r.name}`,
    }))
  } catch {
    return []
  }
}

// ─── HTTP-style API (same shape as before) ───

export async function uploadFile(
  bucket: string,
  name: string,
  data: Buffer | Uint8Array,
  contentType = 'application/octet-stream',
  upsert = false,
): Promise<StoredFile> {
  await ensureBucket(bucket)
  const target = resolvePath(bucket, name)
  const dir = path.dirname(target)
  await mkdir(dir, { recursive: true })

  if (!upsert) {
    try {
      await stat(target)
      const ext = path.extname(name)
      const base = path.basename(name, ext)
      const alt = `${base}-${crypto.randomBytes(4).toString('hex')}${ext}`
      return uploadFile(bucket, name.replace(path.basename(name), alt), data, contentType, true)
    } catch {
      // not exists, ok
    }
  }

  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const safe = safeName(name)

  // Persist to Postgres first (survives disk resets), then cache to disk.
  await dbSave(bucket, safe, buf, contentType)
  try {
    await writeFile(target, buf)
  } catch (e) {
    console.error(`[storage] disk cache write failed for ${bucket}/${safe}:`, (e as Error)?.message)
  }

  return {
    name: safe,
    path: `/${bucket}/${safe}`,
    size: buf.length,
    contentType,
    publicUrl: `${PUBLIC_BASE}/${bucket}/${safe}`,
  }
}

export async function getFile(bucket: string, name: string): Promise<{ data: Buffer; contentType: string } | null> {
  const safe = safeName(name)

  // Prefer Postgres — the source of truth after disk resets.
  const fromDb = await dbGet(bucket, safe)
  if (fromDb) {
    // Refresh the disk cache opportunistically.
    const target = resolvePath(bucket, safe)
    writeFile(target, fromDb.data).catch(() => {})
    return fromDb
  }

  const target = resolvePath(bucket, safe)
  try {
    const data = await readFile(target)
    const ext = path.extname(safe).toLowerCase()
    return { data, contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream' }
  } catch {
    return null
  }
}

export async function deleteFile(bucket: string, name: string): Promise<boolean> {
  const safe = safeName(name)
  await dbDelete(bucket, safe)
  const target = resolvePath(bucket, safe)
  try {
    await unlink(target)
  } catch {
    // nothing on disk — fine, DB row is gone
  }
  return true
}

export async function listFiles(bucket: string, folder?: string): Promise<StoredFile[]> {
  return dbList(bucket, folder)
}