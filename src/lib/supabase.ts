import QRCode from 'qrcode'

/**
 * Drop-in Supabase-compatible client that talks to the self-hosted
 * Fastify backend instead of a Supabase project.
 *
 * Same public surface used across the app:
 *   supabase.from(<table>).select(...).eq(...)        → thenable { data, error }
 *   supabase.rpc(name, args)                          → { data, error }
 *   supabase.auth.{getSession,getUser,signInWithPassword,
 *                  signUp,signOut,onAuthStateChange,refreshSession}
 *   supabase.auth.mfa.{getAuthenticatorAssuranceLevel,listFactors,
 *                      enroll,challengeAndVerify,unenroll}
 *   supabase.storage.from(<bucket>).{upload,getPublicUrl,remove,list}
 *   supabase.functions.invoke(name, { body })
 *   supabase.channel(name).on('postgres_changes', cfg, cb).subscribe()
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const API_BASE = import.meta.env.VITE_API_URL || '/api'

const SESSION_KEY = 'supabase.auth.token'

type Result<T = any> = { data: T | null; error: { message: string } | null }

type ArrayResult = { data: any[] | null; error: { message: string } | null }

/** Minimal local stand-ins for the @supabase/supabase-js `User`/`Factor` types. */
export interface User {
  id: string
  email: string | null
  role: string
  aud: string
  app_metadata: Record<string, any>
  user_metadata: Record<string, any>
  created_at: string | null
  updated_at: string | null
  [key: string]: any
}

export interface Factor {
  id: string
  type: string
  friendlyName: string | null
  status: string | null
  created_at?: string | null
  updated_at?: string | null
  totp?: {
    qr_code?: string | null
    secret?: string | null
    uri?: string | null
  } | null
  [key: string]: any
}

interface StoredSession {
  access_token: string
  refresh_token: string
  expires_at: number
  aal: 'aal1' | 'aal2'
  user: any
}

// ─── session store ────────────────────────────────────────────────────────

let memorySession: StoredSession | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(normalized).split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    )
    return JSON.parse(json) as Record<string, any>
  } catch {
    return null
  }
}

function loadSession(): StoredSession | null {
  if (memorySession) return memorySession
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    memorySession = JSON.parse(raw) as StoredSession
    return memorySession
  } catch {
    return null
  }
}

function saveSession(session: StoredSession | null) {
  memorySession = session
  if (session == null) {
    localStorage.removeItem(SESSION_KEY)
  } else {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }
  scheduleRefresh(session)
}

function toUser(raw: Record<string, any>): User {
  return {
    id: String(raw.id ?? ''),
    email: raw.email ?? null,
    role: raw.role ?? 'authenticated',
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: raw.customFields ?? {},
    created_at: raw.createdAt ?? raw.created_at ?? null,
    updated_at: raw.updatedAt ?? raw.updated_at ?? null,
    ...raw,
  }
}

function currentAccessToken(): string | null {
  return loadSession()?.access_token ?? null
}

function scheduleRefresh(session: StoredSession | null) {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  if (!session?.access_token) return
  const payload = decodeJwtPayload(session.access_token)
  const exp = payload?.exp
  if (!exp || typeof exp !== 'number') return
  const now = Date.now() / 1000
  const ms = Math.max(30_000, (exp - now - 60) * 1000)
  refreshTimer = setTimeout(() => {
    void refreshAccessToken().catch(() => {})
  }, ms)
}

async function refreshAccessToken(): Promise<boolean> {
  const session = loadSession()
  const refreshToken = session?.refresh_token
  if (!refreshToken) return false
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
  if (!res.ok) {
    saveSession(null)
    emitAuth('SIGNED_OUT', null)
    return false
  }
  const body = await res.json()
  const aal = body.aal ?? session.aal
  saveSession({ ...session, access_token: body.accessToken, aal })
  emitAuth('TOKEN_REFRESHED', toStoredSession(loadSession()))
  return true
}

// ─── auth change subscriptions ────────────────────────────────────────────

type AuthListener = (event: string, session: any) => void
const authListeners: Array<{ id: number; callback: AuthListener }> = []
let listenerId = 0

function emitAuth(event: string, session: any) {
  for (const l of authListeners) {
    try {
      l.callback(event, session)
    } catch {
      // listener errors must not break the loop
    }
  }
}

// ─── HTTP helper ──────────────────────────────────────────────────────────

async function http(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ data: any; error: { message: string } | null }> {
  const headers: Record<string, string> = {
    ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers ?? {}),
  }
  const token = currentAccessToken()
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`

  const doFetch = async (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: (init as { signal?: AbortSignal }).signal,
    })

  let response = await doFetch()

  if (response.status === 401 && token) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      headers.Authorization = `Bearer ${currentAccessToken()}`
      response = await doFetch()
    }
  }

  let body: any = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? body?.error ?? `Request failed (${response.status})`
    return { data: null, error: { message: String(message) } }
  }
  return { data: body, error: null }
}

// ─── query builder ────────────────────────────────────────────────────────

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'not' | 'ilike'
interface Filter {
  column: string
  op: FilterOp | 'or'
  value: unknown
}

class QueryBuilder<T = any> implements PromiseLike<ArrayResult> {
  private table: string
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private selectStr = '*'
  private postWriteSelect: string | null = null
  private values: any = undefined
  private onConflict: string | undefined
  private filters: Filter[] = []
  private orders: Array<{ column: string; ascending?: boolean }> = []
  private limitN: number | undefined
  private offsetN: number | undefined

  constructor(table: string) {
    this.table = table
  }

  select(columns?: string) {
    const cols = columns ?? this.selectStr
    if (this.mode === 'select') this.selectStr = cols
    else this.postWriteSelect = cols
    return this
  }

  insert(values: unknown) {
    this.mode = 'insert'
    this.values = values
    return this
  }

  upsert(values: unknown, opts?: { onConflict?: string }) {
    this.mode = 'upsert'
    this.values = values
    this.onConflict = opts?.onConflict
    return this
  }

  update(values: any) {
    this.mode = 'update'
    this.values = values
    return this
  }

  delete() {
    this.mode = 'delete'
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, op: 'eq', value })
    return this
  }

  neq(column: string, value: unknown) {
    this.filters.push({ column, op: 'neq', value })
    return this
  }

  gt(column: string, value: unknown) {
    this.filters.push({ column, op: 'gt', value })
    return this
  }

  gte(column: string, value: unknown) {
    this.filters.push({ column, op: 'gte', value })
    return this
  }

  lt(column: string, value: unknown) {
    this.filters.push({ column, op: 'lt', value })
    return this
  }

  lte(column: string, value: unknown) {
    this.filters.push({ column, op: 'lte', value })
    return this
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ column, op: 'in', value: values })
    return this
  }

  is(column: string, value: unknown) {
    this.filters.push({ column, op: 'is', value })
    return this
  }

  not(column: string, operatorOrValue: unknown, value?: unknown) {
    // Supabase supports .not(column, operator, value) and .not(column, value)
    this.filters.push({ column, op: 'not', value: value === undefined ? operatorOrValue : value })
    return this
  }

  ilike(column: string, pattern: string) {
    this.filters.push({ column, op: 'ilike', value: pattern })
    return this
  }

  or(expression: string) {
    const segments = expression.split(',').map((s) => s.trim()).filter(Boolean)
    const subs: Filter[] = []
    for (const seg of segments) {
      const parsed = seg.match(/^([a-zA-Z_][a-zA-Z0-9_]*?)\.(eq|neq|gt|gte|lt|lte|in|is|not|ilike)\.(.*)$/)
      if (!parsed) continue
      let value: unknown = parsed[3]
      if (parsed[2] === 'is' && value === 'null') value = null
      if (parsed[2] === 'in') value = String(value).split(',')
      subs.push({ column: parsed[1], op: parsed[2] as FilterOp, value })
    }
    if (subs.length > 0) this.filters.push({ column: '__or__', op: 'or', value: subs })
    return this
  }

  order(column: string, opts?: { ascending?: boolean } | any) {
    this.orders.push({ column, ascending: opts?.ascending })
    return this
  }

  limit(n: number) {
    this.limitN = n
    return this
  }

  offset(n: number) {
    this.offsetN = n
    return this
  }

  range(from: number, to: number) {
    this.offsetN = from
    this.limitN = to - from + 1
    return this
  }

  async maybeSingle(): Promise<Result<T>> {
    const res = await this.execute()
    if (res.error) return res as unknown as Result<T>
    if (res.data && Array.isArray(res.data)) {
      return { data: (res.data as T[])[0] ?? null, error: null }
    }
    return res as unknown as Result<T>
  }

  async single(): Promise<Result<T>> {
    const res = await this.execute()
    if (res.error) return res as unknown as Result<T>
    const arr = Array.isArray(res.data) ? (res.data as T[]) : (res.data ? [res.data] : [])
    if (arr.length === 0) return { data: null, error: { message: 'Row not found' } }
    if (arr.length > 1) return { data: null, error: { message: 'Multiple rows returned' } }
    return { data: arr[0], error: null }
  }

  private pickColumns(row: Record<string, any>): Record<string, any> {
    const cols = (this.postWriteSelect ?? this.selectStr ?? '*').trim()
    if (cols === '*' || cols === '') return row
    const keys = cols.split(',').map((c) => c.trim()).filter(Boolean)
    const out: Record<string, any> = {}
    for (const k of keys) {
      if (k in row) out[k] = row[k]
    }
    return out
  }

  async execute(): Promise<ArrayResult> {
    const self = this
    // eslint-disable-next-line no-async-promise-executor
    const made = await (async () => {
      switch (self.mode) {
        case 'insert':
        case 'upsert': {
          const { data, error } = await http('/db/insert', {
            method: 'POST',
            body: { table: self.table, values: self.values, onConflict: self.onConflict },
          })
          if (error) return { data: null, error }
          const rows = (data?.data ?? data ?? []) as unknown[]
          return { data: (rows as any[]).map((r) => self.pickColumns(r as Record<string, any>)) as any, error: null }
        }
        case 'update': {
          const { data, error } = await http('/db/update', {
            method: 'POST',
            body: { table: self.table, values: self.values, filters: self.filters },
          })
          if (error) return { data: null, error }
          const rows = (data?.data ?? data ?? []) as unknown[]
          return { data: (rows as any[]).map((r) => self.pickColumns(r as Record<string, any>)) as any, error: null }
        }
        case 'delete': {
          const { data, error } = await http('/db/delete', {
            method: 'POST',
            body: { table: self.table, filters: self.filters },
          })
          if (error) return { data: null, error }
          return { data: (data?.data ?? data ?? []) as any, error: null }
        }
        default: {
          const { data, error } = await http('/db/select', {
            method: 'POST',
            body: {
              table: self.table,
              select: self.selectStr,
              filters: self.filters,
              order: self.orders,
              limit: self.limitN,
              offset: self.offsetN,
            },
          })
          if (error) return { data: null, error }
          return { data: (data?.data ?? data ?? []) as any, error: null }
        }
      }
    })()
    return made
  }

  then<R1 = ArrayResult, R2 = never>(
    onfulfilled?: ((value: ArrayResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected)
  }
}

// ─── storage ──────────────────────────────────────────────────────────────

function storageBase(): string {
  try {
    return window.location.origin
  } catch {
    return API_BASE
  }
}

function makeStorageBucket(bucket: string) {
  return {
    async upload(path: string, file: File | Blob | ArrayBuffer, options?: { upsert?: boolean }) {
      const fd = new FormData()
      const name = path.split('/').pop() || 'file'
      fd.append('file', new Blob([file]), name)
      try {
        const token = currentAccessToken()
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
        const upsert = options?.upsert ? '?upsert=true' : ''
        const response = await fetch(`${storageBase()}/storage/${bucket}/${path}${upsert}`, {
          method: 'POST',
          headers,
          body: fd,
        })
        if (!response.ok) {
          let msg = `Upload failed (${response.status})`
          try {
            const body = await response.json()
            if (body?.error?.message) msg = body.error.message
          } catch {
            // keep default
          }
          return { data: null, error: { message: msg } }
        }
        const body = await response.json()
        return { data: { path: body.path, publicUrl: body.publicUrl, name: body.name, size: body.size }, error: null }
      } catch (err: any) {
        return { data: null, error: { message: err?.message ?? String(err) } }
      }
    },
    getPublicUrl(path: string) {
      const publicUrl = `${storageBase()}/storage/${bucket}/${path}`
      return { data: { publicUrl }, error: null }
    },
    async remove(paths: string[]) {
      let firstError: string | null = null
      for (const path of paths) {
        try {
          const token = currentAccessToken()
          const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
          const response = await fetch(`${storageBase()}/storage/${bucket}/${path}`, { method: 'DELETE', headers })
          if (!response.ok && !firstError) firstError = `Delete failed (${response.status})`
        } catch (err: any) {
          if (!firstError) firstError = err?.message ?? String(err)
        }
      }
      return { data: firstError ? null : [], error: firstError ? { message: firstError } : null }
    },
    async list(folder?: string) {
      const token = currentAccessToken()
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
      const query = folder ? `?folder=${encodeURIComponent(folder)}` : ''
      try {
        const response = await fetch(`${storageBase()}/storage/api/list/${bucket}${query}`, { headers })
        if (!response.ok) return { data: null, error: { message: `List failed (${response.status})` } }
        const body = await response.json()
        const files = (body?.files ?? []) as any[]
        return {
          data: files.map((f) => ({ name: f.name, id: f.name, ...f })),
          error: null,
        }
      } catch (err: any) {
        return { data: null, error: { message: err?.message ?? String(err) } }
      }
    },
    async download(path: string) {
      const url = `${storageBase()}/storage/${bucket}/${path}`
      return { data: await fetch(url).then((r) => (r.ok ? r.blob() : null)), error: null }
    },
    async createSignedUrl(path: string, _expiresIn?: number) {
      const signedUrl = `${storageBase()}/storage/${bucket}/${path}`
      return { data: { signedUrl }, error: null }
    },
  }
}

// ─── realtime (minimal: attendance polling via backend WS) ────────────────

interface RealtimeChannel {
  on: (event: string, config: any, cb: (...args: any[]) => void) => RealtimeChannel
  subscribe: () => RealtimeChannel
  unsubscribe: () => RealtimeChannel
}

const openChannels = new Set<RealtimeChannelImpl>()

class RealtimeChannelImpl implements RealtimeChannel {
  private ws: WebSocket | null = null
  private handlers: Array<{ config: any; cb: (...args: any[]) => void }> = []
  status = 'UNSUBSCRIBED'

  on(_event: string, config: any, cb: (...args: any[]) => void) {
    this.handlers.push({ config, cb })
    return this
  }

  subscribe() {
    this.status = 'SUBSCRIBED'
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const eventId = this.handlers
        .map((h) => String(h.config?.filter ?? '').match(/event_id=eq\.([0-9a-f-]+)/i))
        .flatMap((m) => (m ? [m[1]] : []))[0]
      if (eventId) {
        this.ws = new WebSocket(`${proto}//${window.location.host}/ws/attendance/${eventId}`)
        this.ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data))
            if (msg.type === 'attendance_update') {
              for (const h of this.handlers) {
                if (h.config?.event === '*' || h.config?.event === 'UPDATE') {
                  h.cb({ eventType: 'UPDATE', new: {}, old: {}, ...(msg ?? {}) }, msg)
                }
              }
            }
          } catch {
            // ignore malformed frames
          }
        }
      }
    } catch {
      // WebSocket unavailable — realtime silently degrades to polling
    }
    openChannels.add(this)
    return this
  }

  unsubscribe() {
    this.status = 'UNSUBSCRIBED'
    try {
      this.ws?.close()
    } catch {
      // ignore
    }
    this.ws = null
    openChannels.delete(this)
    return this
  }
}

// ─── client surface ───────────────────────────────────────────────────────

function mfaFactorsToShape(payload: any): { all: Factor[]; totp: Factor[] } {
  const all = Array.isArray(payload?.all) ? payload.all : []
  const totp = Array.isArray(payload?.totp) ? payload.totp : all.filter((f: any) => f.type === 'totp')
  return { all, totp }
}

export const supabase = {
  from(table: string) {
    return new QueryBuilder(table)
  },

  async rpc(name: string, args?: Record<string, unknown>): Promise<Result<any>> {
    const res = await http(`/rpc/${name}`, { method: 'POST', body: args })
    return { data: res.data?.data ?? res.data, error: res.error }
  },

  auth: {
    async getSession(): Promise<{ data: { session: any }; error: null }> {
      const session = loadSession()
      return { data: { session: session ? toStoredSession(session) : null }, error: null }
    },

    async getUser(): Promise<Result<{ user: User }>> {
      const session = loadSession()
      if (!session) return { data: { user: null as unknown as User }, error: { message: 'Auth session missing' } }
      return { data: { user: session.user }, error: null }
    },

    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const { data, error } = await http('/auth/login', { method: 'POST', body: { email, password } })
      if (error || !data?.accessToken) {
        return { data: { user: null, session: null }, error: error ?? { message: 'Sign in failed' } }
      }
      const user = toUser(data.user)
      const aal: 'aal1' | 'aal2' = data.user?.mfaEnabled ? 'aal1' : 'aal2'
      const session: StoredSession = {
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        expires_at: Date.now() + 15 * 60 * 1000,
        aal,
        user,
      }
      saveSession(session)
      emitAuth('SIGNED_IN', toStoredSession(session))
      return { data: { user, session: toStoredSession(session) }, error: null }
    },

    async signUp({ email, password, options }: { email: string; password: string; options?: { data?: Record<string, string> } }) {
      const meta = options?.data ?? {}
      const body: Record<string, unknown> = {
        email,
        password,
        fullName: meta.full_name ?? meta.fullName ?? '',
        studentId: meta.student_id ?? meta.studentId ?? undefined,
        phone: meta.phone ?? undefined,
        department: meta.department ?? undefined,
        yearOfBirth: meta.year_of_study ?? meta.yearOfBirth ?? undefined,
      }
      const { data, error } = await http('/auth/signup', { method: 'POST', body })
      if (error || !data?.user) {
        return { data: { user: null, session: null }, error: error ?? { message: 'Sign up failed' } }
      }
      const user = toUser(data.user)
      const session: StoredSession = {
        access_token: data.accessToken,
        refresh_token: '',
        expires_at: Date.now() + 15 * 60 * 1000,
        aal: 'aal2',
        user,
      }
      saveSession(session)
      emitAuth('SIGNED_IN', toStoredSession(session))
      return { data: { user, session: toStoredSession(session) }, error: null }
    },

    async signOut() {
      if (loadSession()) {
        try {
          await fetch(`${API_BASE}/auth/logout`, { method: 'POST' }).catch(() => {})
        } catch {
          // ignore
        }
      }
      saveSession(null)
      emitAuth('SIGNED_OUT', null)
      return { error: null }
    },

    onAuthStateChange(callback: (event: string, session: any) => void) {
      const id = ++listenerId
      authListeners.push({ id, callback })
      // fire current session immediately, same as supabase-js
      callback('INITIAL_SESSION', toStoredSession(loadSession()))
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              const idx = authListeners.findIndex((l) => l.id === id)
              if (idx >= 0) authListeners.splice(idx, 1)
            },
          },
        },
      }
    },

    refreshSession({ refresh_token }: { refresh_token?: string } = {}): Promise<{ data: { session: any }; error: { message: string } | null }> {
      const token = refresh_token ?? loadSession()?.refresh_token
      if (!token) return Promise.resolve({ data: { session: null }, error: { message: 'No refresh token' } })
      return refreshAccessToken().then((ok) =>
        ok
          ? { data: { session: toStoredSession(loadSession()) }, error: null }
          : { data: { session: null }, error: { message: 'Refresh failed' } },
      )
    },

    mfa: {
      async getAuthenticatorAssuranceLevel(): Promise<Result<{ currentLevel: string | null; nextLevel: string | null }>> {
        const session = loadSession()
        if (!session) return { data: { currentLevel: null, nextLevel: null }, error: null }
        const payload = decodeJwtPayload(session.access_token)
        return {
          data: {
            currentLevel: session.aal ?? payload?.aal ?? null,
            nextLevel: null,
          },
          error: null,
        }
      },

      async listFactors(): Promise<Result<{ all: Factor[]; totp: Factor[] }>> {
        const { data, error } = await http('/auth/mfa/factors', { method: 'GET' })
        if (error || !data) return { data: { all: [], totp: [] }, error }
        return { data: mfaFactorsToShape(data), error: null }
      },

      async enroll(_: { factorType?: string; friendlyName?: string }): Promise<Result<any>> {
        const { data, error } = await http('/auth/mfa/enroll', { method: 'POST', body: {} })
        if (error || !data) return { data: null, error }
        const qrCode = data.totp?.uri ? await QRCode.toDataURL(data.totp.uri, { width: 260, margin: 2 }) : ''
        return {
          data: {
            id: data.id,
            type: data.type ?? 'totp',
            friendlyName: data.friendlyName ?? 'CIIE Authenticator',
            status: data.status ?? 'unverified',
            totp: { qr_code: qrCode, secret: data.totp?.secret ?? '', uri: data.totp?.uri ?? '' },
          },
          error: null,
        }
      },

      async challengeAndVerify({ code }: { factorId?: string; code: string }): Promise<Result<any>> {
        const session = loadSession()
        const isLoginChallenge = !!session?.user?.mfaEnabled
        const { data, error } = await http(isLoginChallenge ? '/auth/mfa/verify-login' : '/auth/mfa/verify', {
          method: 'POST',
          body: { code },
        })
        if (error || !data) return { data: null, error: error ?? { message: 'Verification failed' } }
        if (data.accessToken && session) {
          saveSession({ ...session, access_token: data.accessToken, aal: 'aal2', user: { ...session.user, mfaEnabled: true } })
          emitAuth('MFA_CHALLENGE_VERIFIED', toStoredSession(loadSession()))
        }
        return { data: { verified: true, ...data }, error: null }
      },

      async unenroll(_: { factorId?: string }): Promise<Result<any>> {
        const { error } = await http('/auth/mfa/unenroll', { method: 'POST', body: {} })
        if (error) return { data: null, error }
        return { data: { id: 'totp' }, error: null }
      },
    },
  },

  storage: {
    from(bucket: string) {
      return makeStorageBucket(bucket)
    },
  },

  functions: {
    async invoke(name: string, opts?: { body?: unknown; signal?: AbortSignal }): Promise<Result<any>> {
      const init = { method: 'POST', body: opts?.body, signal: opts?.signal }
      const { data, error } = await http(`/functions/${name}`, init as any)
      if (error) {
        return { data: null, error: { message: error.message, context: undefined } as any }
      }
      return { data: data?.data ?? data, error: null }
    },
  },

  channel(name: string): RealtimeChannel {
    void name
    return new RealtimeChannelImpl()
  },

  removeChannel(channel: RealtimeChannel) {
    channel.unsubscribe()
  },

  getChannels() {
    return [...openChannels] as any[]
  },
}

function toStoredSession(session: StoredSession | null) {
  if (!session) return null
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    aal: session.aal,
    user: session.user,
  }
}