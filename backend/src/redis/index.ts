import Redis from 'ioredis'
import { config } from '../config/index.js'

const isTls = config.REDIS_URL.startsWith('rediss://') || config.REDIS_URL.includes('upstash.io')

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  retryStrategy(times: number) {
    const delay = Math.min(times * 100, 3000)
    return delay
  },
  ...(isTls ? { tls: {} } : {}),
})

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message)
})

redis.on('connect', () => {
  console.log('[Redis] Connected')
})

// ─── In-memory fallback ───
// Redis is optional in development. When it is unreachable we keep a small
// process-local TTL store so flows that depend on short-lived cache entries
// (MFA enrollment, email OTP throttling, rate limits) still work.

interface MemoryEntry {
  value: string
  expiresAt: number
}

const memoryStore = new Map<string, MemoryEntry>()

function redisReady(): boolean {
  return redis.status === 'ready'
}

function memoryGet(key: string): string | null {
  const entry = memoryStore.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key)
    return null
  }
  return entry.value
}

function memorySet(key: string, value: string, ttlSeconds: number): void {
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
}

function memoryDel(...keys: string[]): void {
  for (const key of keys) memoryStore.delete(key)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function memoryDelPattern(pattern: string): void {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`)
  for (const key of memoryStore.keys()) {
    if (regex.test(key)) memoryStore.delete(key)
  }
}

// Drop expired entries periodically so the map cannot grow unbounded.
const cleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAt <= now) memoryStore.delete(key)
  }
}, 60_000)
cleanupTimer.unref?.()

// ─── Cache Helpers ───

export async function cacheGet<T>(key: string): Promise<T | null> {
  let data: string | null = null
  if (redisReady()) {
    try {
      data = await redis.get(key)
    } catch {
      data = null
    }
  }
  if (data === null) data = memoryGet(key)
  if (!data) return null
  try {
    return JSON.parse(data) as T
  } catch {
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  const data = JSON.stringify(value)
  memorySet(key, data, ttlSeconds)
  if (redisReady()) {
    try {
      await redis.set(key, data, 'EX', ttlSeconds)
    } catch {
      // memory fallback already holds the value
    }
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return
  memoryDel(...keys)
  if (redisReady()) {
    try {
      await redis.del(...keys)
    } catch {
      // ignore
    }
  }
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  memoryDelPattern(pattern)
  if (redisReady()) {
    try {
      const keys = await redis.keys(pattern)
      if (keys.length > 0) await redis.del(...keys)
    } catch {
      // ignore
    }
  }
}

export async function incrWithExpiry(key: string, ttlSeconds: number): Promise<number> {
  if (redisReady()) {
    try {
      const val = await redis.incr(key)
      if (val === 1) await redis.expire(key, ttlSeconds)
      return val
    } catch {
      // fall through to memory
    }
  }
  const current = Number(memoryGet(key) ?? '0') + 1
  const entry = memoryStore.get(key)
  const remaining = entry ? Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000)) : ttlSeconds
  memorySet(key, String(current), remaining)
  return current
}
