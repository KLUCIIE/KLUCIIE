import { pgClient } from '../db/index.js'
import * as schema from '../db/schema.js'
import { cacheDel } from '../redis/index.js'
import { BadRequestError } from '../utils/errors.js'

// ─── Table registry built from the Drizzle schema ───
const TABLES: Map<string, { key: string; dbName: string; columns: Map<string, string>; arrayCols: Set<string> }> = new Map()

for (const [key, value] of Object.entries(schema)) {
  const cols = (value as any)?.[Symbol.for('drizzle:Columns')]
  if (cols && typeof cols === 'object') {
    const dbName = (value as any)?.[Symbol.for('drizzle:Name')] ?? key
    const columns = new Map<string, string>()
    const arrayCols = new Set<string>()
    for (const [colKey, col] of Object.entries(cols as Record<string, any>)) {
      if (col && typeof col === 'object' && 'name' in col) {
        columns.set(colKey, col.name)
        columns.set(col.name, col.name)
        if (col.dataType === 'array') arrayCols.add(col.name)
      }
    }
    TABLES.set(key, { key, dbName, columns, arrayCols })
    if (dbName !== key) TABLES.set(dbName, { key, dbName, columns, arrayCols })
  }
}

function resolveTable(name: string) {
  const t = TABLES.get(name)
  if (t) return t
  // Fallback for non-registered tables/views (e.g. v_member_stats): treat as a
  // plain identifier so columns are passed through verbatim.
  const valid = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
  if (!valid) throw new BadRequestError(`Invalid table name "${name}"`)
  return { key: name, dbName: name, columns: new Map<string, string>(), arrayCols: new Set<string>() }
}

function quoteIdent(id: string): string {
  const valid = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)
  if (!valid) throw new BadRequestError(`Invalid identifier "${id}"`)
  return `"${id}"`
}

/** Encode a JS array as a Postgres array literal (e.g. ["a","b"] → {"a","b"}). */
function pgArrayLiteral(arr: unknown[]): string {
  const items = arr.map((v) => {
    if (v === null || v === undefined) return 'NULL'
    return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  })
  return `{${items.join(',')}}`
}

/** Value bound into SQL. `asArray` forces array-literal encoding (text[] columns);
 *  jsonb columns get a JSON string instead. */
function normalizeValue(v: unknown, asArray = false): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return asArray ? pgArrayLiteral(v) : JSON.stringify(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}

/** Split a select string on commas, but respect parentheses so
 *  `member:profiles(full_name, ciie_id)` is NOT split in two. */
function splitSelect(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') depth--
    else if (s[i] === ',' && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

// ─── FK resolution map (source table column whose value references target) ───
const FK_MAP: Record<string, Record<string, string>> = {
  event_team_members: { member_id: 'profiles', role_id: 'event_roles', event_id: 'events', created_by: 'profiles' },
  event_registrations: { event_id: 'events', member_id: 'profiles' },
  member_points_transactions: { member_id: 'profiles', event_id: 'events', awarded_by: 'profiles' },
  recruit_reject_requests: { requested_by: 'profiles', decided_by: 'profiles' },
  recruit_emails: { sent_by: 'profiles', application_id: 'recruit_applications' },
  duty_assignments: { duty_id: 'duties', member_id: 'profiles' },
  attendance: { event_id: 'events', member_id: 'profiles', registration_id: 'event_registrations', marked_by: 'profiles' },
  duty_files: { duty_id: 'duties', uploaded_by: 'profiles' },
  certificates: { event_id: 'events', member_id: 'profiles', issued_by: 'profiles', registration_id: 'event_registrations' },
  gallery_items: { event_id: 'events', uploaded_by: 'profiles' },
  announcements: { event_id: 'events', created_by: 'profiles' },
  posts: { author_id: 'profiles' },
  events: { created_by: 'profiles' },
  recruit_applications: { member_id: 'profiles', gd_form_id: 'recruit_form_templates', interview_form_id: 'recruit_form_templates', decided_by: 'profiles' },
  recruit_evaluations: { application_id: 'recruit_applications', evaluator_id: 'profiles' },
  faculty_form_submissions: { form_id: 'faculty_forms', member_id: 'profiles' },
  faculty_forms: { created_by: 'profiles' },
  admin_audit_logs: { actor_id: 'profiles' },
  member_privacy_settings: { member_id: 'profiles' },
  member_qr_codes: { member_id: 'profiles' },
  member_achievements: { member_id: 'profiles', created_by: 'profiles' },
  point_rules: { created_by: 'profiles' },
  admin_recovery_codes: { admin_id: 'profiles' },
  event_round_windows: { event_id: 'events' },
  duties: { event_id: 'events', assigned_to: 'profiles', created_by: 'profiles' },
}

function resolveFk(sourceTable: string, token: string | undefined): { column: string; target: string } | null {
  if (!token) return null
  let name = token
  if (name.endsWith('_fkey')) name = name.slice(0, -'_fkey'.length)
  const map = FK_MAP[sourceTable] ?? {}
  if (map[name]) return { column: name, target: map[name] }
  // FK constraint names often include the table prefix: e.g.
  // "attendance_marked_by_fkey" → strip _fkey → "attendance_marked_by"
  // → column is "marked_by". Try matching every known column by suffix.
  for (const [col, target] of Object.entries(map)) {
    if (name.endsWith(`_${col}`)) return { column: col, target }
  }
  // Fallback: last underscore segment (e.g. "event_id_fkey" → "id" won't match,
  // but "event_id" is a direct match above).
  const idx = name.lastIndexOf('_')
  if (idx > 0) {
    const short = name.slice(idx + 1)
    if (map[short]) return { column: short, target: map[short] }
  }
  return null
}

/**
 * Infers the FK for an embedded relation when no `!fkey` token is present
 * (PostgREST auto-resolves single/named relationships). Scores candidate
 * columns by how well the alias matches the column name.
 */
function inferFk(sourceTable: string, alias: string): { column: string; target: string } | null {
  const entries = Object.entries(FK_MAP[sourceTable] ?? {})
  if (entries.length === 0) return null
  let best: { column: string; target: string } | null = null
  let bestScore = 0
  for (const [col, target] of entries) {
    const seg = col.split('_').pop() ?? col
    let score = 0
    if (col === alias) score = 100
    else if (seg === alias) score = 60
    else if (col === `${alias}_id`) score = 40
    if (score > bestScore) {
      bestScore = score
      best = { column: col, target }
    }
  }
  return best
}

/**
 * Resolves has-many (reverse) relations: the embed table itself holds a FK
 * column that references the source table. Returns the FK column on the target
 * when a match is found, otherwise null.
 */
function inferReverse(
  sourceTable: string,
  rel: { alias: string; table: string; fkToken?: string },
): { column: string; target: string } | null {
  const map = FK_MAP[rel.table]
  if (!map) return null
  if (rel.fkToken) {
    let name = rel.fkToken
    if (name.endsWith('_fkey')) name = name.slice(0, -'_fkey'.length)
    if (map[name] === sourceTable) return { column: name, target: rel.table }
    return null
  }
  const matches = Object.entries(map).filter(([, target]) => target === sourceTable)
  if (matches.length === 0) return null
  if (matches.length === 1) return { column: matches[0][0], target: rel.table }
  const preferred = matches.find(([col]) => col.endsWith(`_${rel.table}`) || col === rel.table)
  return preferred ? { column: preferred[0], target: rel.table } : { column: matches[0][0], target: rel.table }
}

function parseEmbedded(seg: string): { alias: string; table: string; columns: string[]; inner: boolean; fkToken?: string } | null {
  const m = seg.match(/^([a-zA-Z_][a-zA-Z0-9_]*):([a-zA-Z_][a-zA-Z0-9_]*)(![^()]*)?\(([^()]*)\)$/)
  if (!m) return null
  const flags = (m[3] ?? '').split('!').filter(Boolean)
  const columns = m[4] === '*' ? ['*'] : m[4].split(',').map((c) => c.trim()).filter(Boolean)
  return {
    alias: m[1],
    table: m[2],
    columns,
    inner: flags.includes('inner'),
    fkToken: flags.find((f) => f !== 'inner'),
  }
}

export type FilterOp = 'eq' | 'neq' | 'in' | 'is' | 'not' | 'gt' | 'gte' | 'lt' | 'lte' | 'or'

export interface DataFilter {
  column: string
  op: FilterOp
  value: unknown
}

export interface DataSelectInput {
  table: string
  select?: string
  filters?: DataFilter[]
  order?: { column: string; ascending?: boolean }[]
  limit?: number
  offset?: number
}

/** `alias` is the SQL alias for the table (t0 for root, embedded alias for joins). */
function colRef(alias: string, table: { columns: Map<string, string> } | undefined, raw: string): string {
  let name = raw
  if (table) {
    const known = table.columns.get(name)
    if (known) name = known
  }
  return quoteIdent(alias) + '.' + quoteIdent(name)
}

function buildWhere(ctx: { values: unknown[] }, conditions: DataFilter[], alias: string, table?: { columns: Map<string, string> }): string {
  const parts: string[] = []
  for (const f of conditions) {
    const col = colRef(alias, table, f.column)
    const param = () => {
      ctx.values.push(normalizeValue(f.value))
      return `$${ctx.values.length}`
    }
    switch (f.op) {
      case 'eq':
        parts.push(f.value === null ? `${col} IS NULL` : `${col} = ${param()}`)
        break
      case 'neq':
        parts.push(f.value === null ? `${col} IS NOT NULL` : `${col} <> ${param()}`)
        break
      case 'gt': parts.push(`${col} > ${param()}`); break
      case 'gte': parts.push(`${col} >= ${param()}`); break
      case 'lt': parts.push(`${col} < ${param()}`); break
      case 'lte': parts.push(`${col} <= ${param()}`); break
      case 'in': {
        const arr = Array.isArray(f.value) ? f.value.filter((v) => v !== null && v !== undefined) : []
        if (arr.length === 0) {
          parts.push('false')
        } else {
          const ph = arr.map((v) => {
            ctx.values.push(normalizeValue(v))
            return `$${ctx.values.length}`
          }).join(', ')
          parts.push(`${col} IN (${ph})`)
        }
        break
      }
      case 'is':
        parts.push(f.value === null ? `${col} IS NULL` : `${col} = ${param()}`)
        break
      case 'not':
        parts.push(f.value === null ? `${col} IS NOT NULL` : `${col} <> ${param()}`)
        break
      case 'or': {
        const subs = Array.isArray(f.value) ? (f.value as DataFilter[]) : []
        if (subs.length === 0) {
          parts.push('false')
          break
        }
        const inner = subs.map((sf) => {
          const sub = buildWhere(ctx, [sf], alias, table)
          return sub || 'false'
        }).join(' OR ')
        parts.push(`(${inner})`)
        break
      }
      default:
        throw new BadRequestError(`Unsupported filter op "${f.op}"`)
    }
  }
  return parts.join(' AND ')
}

export async function runSelect(input: DataSelectInput): Promise<any[]> {
  const tableDef = resolveTable(input.table)
  const dbName = tableDef.dbName
  const ctx = { values: [] as unknown[] }

  const plainCols: string[] = []
  const embeds: Array<{ alias: string; table: string; columns: string[]; inner: boolean; fkToken?: string }> = []
  let selectAll = false
  const seen = new Set<string>()

  if (input.select && input.select.trim() !== '' && input.select !== '*') {
    for (const seg of splitSelect(input.select)) {
      const s = seg.trim()
      if (!s) continue
      if (s === '*') { selectAll = true; continue }
      const parsed = parseEmbedded(s)
      if (parsed) embeds.push(parsed)
      else if (!seen.has(s)) { seen.add(s); plainCols.push(s) }
    }
  } else {
    selectAll = true
  }

  // Split filters into base + embedded-alias filters
  const baseFilters: DataFilter[] = []
  const relFilters: Record<string, DataFilter[]> = {}
  for (const f of input.filters ?? []) {
    const dot = f.column.indexOf('.')
    if (dot > 0) {
      const alias = f.column.slice(0, dot)
      const col = f.column.slice(dot + 1)
      if (!relFilters[alias]) relFilters[alias] = []
      relFilters[alias].push({ ...f, column: col })
    } else {
      baseFilters.push(f)
    }
  }

  // Join specs (forward FKs are joined in SQL; reverse/has-many are resolved as separate queries)
  const joins: Array<{ alias: string; table: string; tableDb: string; column: string; inner: boolean; filters: DataFilter[] }> = []
  const reverseRels: typeof joins = []
  for (const rel of embeds) {
    let fk = rel.fkToken ? resolveFk(input.table, rel.fkToken) : inferFk(input.table, rel.alias)
    let reverse = false
    if (!fk) {
      fk = inferReverse(input.table, rel)
      if (fk) {
        reverse = true
        fk = { column: fk.column, target: fk.target }
      }
    }
    if (!fk) throw new BadRequestError(`Cannot resolve relation "${rel.alias}" on "${input.table}"`)
    const target = resolveTable(fk.target)
    const spec = {
      alias: rel.alias,
      table: fk.target,
      tableDb: target.dbName,
      column: fk.column,
      inner: rel.inner,
      filters: relFilters[rel.alias] ?? [],
    }
    if (reverse) reverseRels.push(spec)
    else joins.push(spec)
  }

  const selectParts: string[] = []
  const needRootId = reverseRels.length > 0
  if (selectAll) {
    selectParts.push('t0.*')
  } else {
    for (const c of plainCols) selectParts.push(colRef('t0', tableDef, c))
    if (needRootId && !plainCols.includes('id')) selectParts.push('t0.id AS "__root_id"')
  }
  for (const rel of embeds) {
    if (reverseRels.some((r) => r.alias === rel.alias)) continue
    const j = joins.find((j) => j.alias === rel.alias)!
    if (rel.columns[0] === '*') {
      selectParts.push(`${quoteIdent(rel.alias)}.*`)
    } else {
      for (const c of rel.columns) selectParts.push(`${quoteIdent(rel.alias)}.${quoteIdent(c)} AS ${quoteIdent(`${rel.alias}__${c}`)}`)
    }
  }

  const whereSql = buildWhere(ctx, baseFilters, 't0', tableDef)
  const where = whereSql ? ` WHERE ${whereSql}` : ''

  let joinSql = ''
  for (const j of joins) {
    const kind = j.inner ? 'JOIN' : 'LEFT JOIN'
    let on = `${quoteIdent(j.alias)}.id = t0.${quoteIdent(j.column)}`
    if (j.filters.length > 0) {
      const target = resolveTable(j.table)
      const jf = buildWhere(ctx, j.filters, j.alias, target)
      on += ` AND (${jf})`
    }
    joinSql += `${kind} ${quoteIdent(j.tableDb)} AS ${quoteIdent(j.alias)} ON ${on} `
  }

  let orderSql = ''
  if (input.order && input.order.length > 0) {
    const parts = input.order.map((o) => `${colRef('t0', tableDef, o.column)} ${o.ascending === false ? 'DESC' : 'ASC'}`)
    orderSql = ` ORDER BY ${parts.join(', ')}`
  }

  let limitSql = ''
  if (input.limit && input.limit > 0) {
    ctx.values.push(input.limit)
    limitSql = ` LIMIT $${ctx.values.length}`
  }
  let offsetSql = ''
  if (input.offset && input.offset > 0) {
    ctx.values.push(input.offset)
    offsetSql = ` OFFSET $${ctx.values.length}`
  }

  const sql = `SELECT ${selectParts.join(', ')} FROM ${quoteIdent(dbName)} AS t0 ${joinSql}${where}${orderSql}${limitSql}${offsetSql}`

  if (process.env.DEBUG_SQL) {
    console.log('[data.service] SQL:', sql, ctx.values)
  }

  let rows: any[] = []
  try {
    const res = await pgClient.unsafe(sql, ctx.values as any[])
    rows = Array.isArray(res) ? (res as any[]) : []
  } catch (e: any) {
    throw new BadRequestError(`Query failed: ${e?.message ?? String(e)}`)
  }

  if (embeds.length > 0) {
    rows = rows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        const idx = k.indexOf('__')
        if (idx === -1) { out[k] = v; continue }
        const alias = k.slice(0, idx)
        const col = k.slice(idx + 2)
        let obj = out[alias] as Record<string, unknown> | undefined
        if (!obj) {
          obj = {} as Record<string, unknown>
          out[alias] = obj
        }
        obj[col] = v
      }
      return out
    })
  }

  // Resolve reverse (has-many) embeds as separate queries keyed by root id.
  for (const rev of reverseRels) {
    const target = resolveTable(rev.table)
    const ctx2 = { values: [] as unknown[] }
    const ids = rows.map((r) => (r as any).__root_id ?? (r as any).id).filter((id) => id !== null && id !== undefined)
    let children: any[] = []
    if (ids.length > 0) {
      const filters: DataFilter[] = [...rev.filters, { column: rev.column, op: 'in', value: ids }]
      const w = buildWhere(ctx2, filters, rev.alias, target)
      const sql = `SELECT ${quoteIdent(rev.alias)}.* FROM ${quoteIdent(rev.tableDb)} AS ${quoteIdent(rev.alias)} WHERE ${w}`
      if (process.env.DEBUG_SQL) {
        console.log('[data.service] reverse SQL:', sql, ctx2.values)
      }
      try {
        const res = await pgClient.unsafe(sql, ctx2.values as any[])
        children = Array.isArray(res) ? (res as any[]) : []
      } catch (e: any) {
        throw new BadRequestError(`Query failed: ${e?.message ?? String(e)}`)
      }
    }
    const byKey = new Map<string | number, any[]>()
    for (const c of children) {
      const key = c[rev.column]
      const arr = byKey.get(key) ?? []
      arr.push(c)
      byKey.set(key, arr)
    }
    const kept: any[] = []
    for (const row of rows) {
      const key = (row as any).__root_id ?? (row as any).id
      const arr = byKey.get(key) ?? []
      if (rev.inner && arr.length === 0) continue
      ;(row as any)[rev.alias] = arr
      delete (row as any).__root_id
      kept.push(row)
    }
    rows = kept
  }

  return rows
}

export interface DataWriteInput {
  table: string
  values: Record<string, unknown>
  onConflict?: string
  filters?: DataFilter[]
}

export async function runInsert(input: DataWriteInput): Promise<any[]> {
  const tableDef = resolveTable(input.table)
  const dbName = tableDef.dbName
  const ctx = { values: [] as unknown[] }

  const items = Array.isArray(input.values) ? (input.values as Record<string, unknown>[]) : [input.values]
  if (items.length === 0) throw new BadRequestError('No values provided for insert')

  const allKeys = new Set<string>()
  for (const it of items) for (const k of Object.keys(it)) if (it[k] !== undefined) allKeys.add(k)
  const sampleCols = [...allKeys]
  if (sampleCols.length === 0) throw new BadRequestError('No values provided for insert')

  const cols = sampleCols.map((c) => quoteIdent(tableDef.columns.get(c) ?? c))

  const rowSql: string[] = []
  for (const item of items) {
    const vals = sampleCols.map((c) => {
      const dbCol = tableDef.columns.get(c) ?? c
      ctx.values.push(normalizeValue(item[c], tableDef.arrayCols.has(dbCol)))
      return `$${ctx.values.length}`
    })
    rowSql.push(`(${vals.join(', ')})`)
  }

  let sql = `INSERT INTO ${quoteIdent(dbName)} (${cols.join(', ')}) VALUES ${rowSql.join(', ')}`
  if (input.onConflict) {
    const oc = tableDef.columns.get(input.onConflict) ?? input.onConflict
    sql += ` ON CONFLICT (${quoteIdent(oc)}) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
  }
  sql += ' RETURNING *'

  const res = await pgClient.unsafe(sql, ctx.values as any[])
  return Array.isArray(res) ? (res as any[]) : []
}

export async function runUpdate(input: DataWriteInput): Promise<any[]> {
  const tableDef = resolveTable(input.table)
  const dbName = tableDef.dbName
  const ctx = { values: [] as unknown[] }

  const entries = Object.entries(input.values ?? {}).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return []

  const sets = entries.map(([c, v]) => {
    const dbCol = tableDef.columns.get(c) ?? c
    ctx.values.push(normalizeValue(v, tableDef.arrayCols.has(dbCol)))
    return `${quoteIdent(dbCol)} = $${ctx.values.length}`
  })

  const whereSql = buildWhere(ctx, input.filters ?? [], 't0', tableDef)
  const where = whereSql ? ` WHERE ${whereSql}` : ''
  const sql = `UPDATE ${quoteIdent(dbName)} AS t0 SET ${sets.join(', ')}${where} RETURNING *`
  const res = await pgClient.unsafe(sql, ctx.values as any[])
  const rows = Array.isArray(res) ? (res as any[]) : []
  // getProfile() memoizes rows under `profile:<id>`; drop those entries so the
  // next read sees the fresh values (role, mfa flags, custom fields, …).
  if (tableDef.key === 'profiles') {
    const ids = rows.map((r) => r?.id).filter((id): id is string => !!id)
    if (ids.length > 0) await cacheDel(...ids.map((id) => `profile:${id}`))
  }
  return rows
}

export async function runDelete(input: { table: string; filters?: DataFilter[] }): Promise<any[]> {
  const tableDef = resolveTable(input.table)
  const dbName = tableDef.dbName
  const ctx = { values: [] as unknown[] }
  const whereSql = buildWhere(ctx, input.filters ?? [], dbName, tableDef)
  const where = whereSql ? ` WHERE ${whereSql}` : ''
  const sql = `DELETE FROM ${quoteIdent(dbName)} AS ${quoteIdent(dbName)}${where} RETURNING *`
  const res = await pgClient.unsafe(sql, ctx.values as any[])
  const rows = Array.isArray(res) ? (res as any[]) : []
  if (tableDef.key === 'profiles') {
    const ids = rows.map((r) => r?.id).filter((id): id is string => !!id)
    if (ids.length > 0) await cacheDel(...ids.map((id) => `profile:${id}`))
  }
  return rows
}