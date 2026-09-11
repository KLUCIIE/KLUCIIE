import Redis from 'ioredis'
import { config } from '../config/index.js'

const isTls = config.REDIS_URL.startsWith('rediss://') || config.REDIS_URL.includes('upstash.io')

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
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

// ─── Cache Helpers ───

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const data = await redis.get(key)
    if (!data) return null
    return JSON.parse(data) as T
  } catch {
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // silently fail — cache miss is acceptable
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  try {
    if (keys.length > 0) await redis.del(...keys)
  } catch {
    // silently fail
  }
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern)
    if (keys.length > 0) await redis.del(...keys)
  } catch {
    // silently fail
  }
}

export async function incrWithExpiry(key: string, ttlSeconds: number): Promise<number> {
  try {
    const val = await redis.incr(key)
    if (val === 1) {
      await redis.expire(key, ttlSeconds)
    }
    return val
  } catch {
    return 0
  }
}
