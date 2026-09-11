import { mkdir, writeFile, readFile, unlink, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from '../config/index.js'

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.resolve(process.cwd(), 'uploads')
const PUBLIC_BASE = process.env.STORAGE_PUBLIC_URL || '/storage'

export interface StoredFile {
  name: string
  path: string
  size: number
  contentType: string
  publicUrl: string
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._\-/]/g, '_')
  return cleaned.replace(/^\/+/, '').replace(/\/+/g, '/')
}

function resolvePath(bucket: string, name: string): string {
  const b = safeName(bucket)
  const n = safeName(name)
  if (n.includes('..')) throw new Error('Invalid path')
  return path.join(STORAGE_ROOT, b, n)
}

export async function ensureBucket(bucket: string): Promise<void> {
  const b = safeName(bucket)
  await mkdir(path.join(STORAGE_ROOT, b), { recursive: true })
}

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

  await writeFile(target, data)
  const info = await stat(target)
  return {
    name: safeName(name),
    path: `/${bucket}/${safeName(name)}`,
    size: info.size,
    contentType,
    publicUrl: `${PUBLIC_BASE}/${bucket}/${safeName(name)}`,
  }
}

export async function getFile(bucket: string, name: string): Promise<{ data: Buffer; contentType: string } | null> {
  const target = resolvePath(bucket, name)
  try {
    const data = await readFile(target)
    const ext = path.extname(name).toLowerCase()
    const contentTypes: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
      '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
      '.txt': 'text/plain', '.json': 'application/json',
    }
    return { data, contentType: contentTypes[ext] ?? 'application/octet-stream' }
  } catch {
    return null
  }
}

export async function deleteFile(bucket: string, name: string): Promise<boolean> {
  const target = resolvePath(bucket, name)
  try {
    await unlink(target)
    return true
  } catch {
    return false
  }
}

export async function listFiles(bucket: string, folder?: string): Promise<StoredFile[]> {
  await ensureBucket(bucket)
  const base = path.join(STORAGE_ROOT, safeName(bucket), safeName(folder ?? ''))
  try {
    const entries = await readdir(base, { withFileTypes: true, recursive: true })
    const files: StoredFile[] = []
    for (const e of entries) {
      if (e.isFile()) {
        const abs = path.join(base, e.name)
        const rel = path.relative(path.join(STORAGE_ROOT, safeName(bucket)), abs).replace(/\\/g, '/')
        const info = await stat(abs)
        const ext = path.extname(e.name).toLowerCase()
        const contentTypes: Record<string, string> = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
          '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
          '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
          '.txt': 'text/plain', '.json': 'application/json',
        }
        files.push({
          name: e.name,
          path: `/${bucket}/${rel}`,
          size: info.size,
          contentType: contentTypes[ext] ?? 'application/octet-stream',
          publicUrl: `${PUBLIC_BASE}/${bucket}/${rel}`,
        })
      }
    }
    return files
  } catch {
    return []
  }
}