const BASE = 'http://localhost:3001'
const MEMBER = { email: 'test@kluniversity.in', password: 'TestPass123!' }
const ADMIN = { email: 'admin@kluniversity.in', password: 'AdminPass123!' }

let pass = 0
let fail = 0
const results: string[] = []

async function login(c: { email: string; password: string }) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`login failed: ${r.status} ${JSON.stringify(j)}`)
  return { token: j.accessToken, uid: j.user.id }
}

async function db(token: string, route: string, body: unknown) {
  const r = await fetch(`${BASE}/api/db/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, j }
}

function check(name: string, expected: number, got: number) {
  if (got === expected) { pass++; results.push(`PASS ${name} (${got})`) }
  else { fail++; results.push(`FAIL ${name}: expected ${expected}, got ${got} ${JSON.stringify(gotJson(name))}`) }
}
const gotJsonMap = new Map<string, any>()
function gotJson(name: string) { return gotJsonMap.get(name) ?? '' }
async function t(name: string, expected: number, r: { status: number; j: any }) {
  gotJsonMap.set(name, r.j)
  check(name, expected, r.status)
}

const rec = await login(MEMBER)
const adm = await login(ADMIN)
console.log('logins ok: member=', rec.uid, 'admin=', adm.uid)

// ─── member: blocked writes ───
await t('member-insert-events (blocked)', 403, await db(rec.token, 'insert', { table: 'events', values: { title: 'H4CK', status: 'upcoming', start_date: '2026-12-01' } }))
await t('member-insert-announcements (blocked)', 403, await db(rec.token, 'insert', { table: 'announcements', values: { title: 'H4CK' } }))
await t('member-insert-posts (blocked)', 403, await db(rec.token, 'insert', { table: 'posts', values: { title: 'H4CK' } }))
await t('member-update-platform_settings (blocked)', 403, await db(rec.token, 'update', { table: 'platform_settings', values: { amtps_mode: true }, filters: [{ column: 'id', op: 'eq', value: 1 }] }))
await t('member-upsert-other-privacy (blocked)', 403, await db(rec.token, 'insert', { table: 'member_privacy_settings', values: { member_id: adm.uid, show_on_leaderboard: true } }))
await t('member-update-other-privacy (blocked)', 403, await db(rec.token, 'update', { table: 'member_privacy_settings', values: { show_on_leaderboard: true }, filters: [{ column: 'member_id', op: 'eq', value: adm.uid }] }))
await t('member-delete-gallery (blocked)', 403, await db(rec.token, 'delete', { table: 'gallery_items', filters: [{ column: 'id', op: 'eq', value: 1 }] }))
await t('member-insert-duties (blocked)', 403, await db(rec.token, 'insert', { table: 'duties', values: { title: 'H4CK' } }))

// ─── member: allowed self writes ───
await t('member-upsert-own-privacy (allowed)', 201, await db(rec.token, 'insert', { table: 'member_privacy_settings', values: { member_id: rec.uid, show_on_leaderboard: true, show_public_profile: true }, onConflict: 'member_id' }))
await t('member-update-own-privacy (allowed)', 200, await db(rec.token, 'update', { table: 'member_privacy_settings', values: { show_on_leaderboard: false }, filters: [{ column: 'member_id', op: 'eq', value: rec.uid }] }))
await t('member-update-own-profile (allowed)', 200, await db(rec.token, 'update', { table: 'profiles', values: { phone: '+9199991111' }, filters: [{ column: 'id', op: 'eq', value: rec.uid }] }))

// ─── admin: writes to public content tables ───
const ev = await db(adm.token, 'insert', { table: 'events', values: { title: 'E2E Smoke Event', status: 'upcoming', start_date: '2026-12-01' } })
await t('admin-insert-events (allowed)', 201, ev)
const ann = await db(adm.token, 'insert', { table: 'announcements', values: { title: 'E2E Smoke Announcement' } })
await t('admin-insert-announcements (allowed)', 201, ann)
await t('admin-update-platform_settings (allowed)', 200, await db(adm.token, 'update', { table: 'platform_settings', values: { amtps_mode: false }, filters: [{ column: 'id', op: 'eq', value: 1 }] }))
await t('admin-update-other-privacy (allowed)', 200, await db(adm.token, 'update', { table: 'member_privacy_settings', values: { show_on_leaderboard: true }, filters: [{ column: 'member_id', op: 'eq', value: rec.uid }] }))

// cleanup rows created by the smoke
const evId = ev.j?.data?.[0]?.id
const annId = ann.j?.data?.[0]?.id
if (evId) await db(adm.token, 'delete', { table: 'events', filters: [{ column: 'id', op: 'eq', value: evId }] })
if (annId) await db(adm.token, 'delete', { table: 'announcements', filters: [{ column: 'id', op: 'eq', value: annId }] })

// ─── RPC/functions/mfa smoke ───
const rpc1 = await fetch(`${BASE}/api/rpc/get_leaderboard`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rec.token}` }, body: JSON.stringify({}) })
await t('rpc-get_leaderboard (allowed)', 200, { status: rpc1.status, j: await rpc1.json().catch(() => ({})) })

// ─── functions: bulk-create → bulk-delete ───
async function fn(token: string, name: string, body: unknown) {
  const r = await fetch(`${BASE}/api/functions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return { status: r.status, j: await r.json().catch(() => ({})) }
}
const bc = await fn(adm.token, 'bulk-create-members', { role: 'member', members: [{ full_name: 'E2E Bulk User', email: 'e2e.bulk@kluniversity.in', department: 'CSE', year_of_study: '2' }] })
await t('functions-bulk-create (allowed)', 200, bc)
const bd = await fn(adm.token, 'bulk-delete-members', { emails: ['e2e.bulk@kluniversity.in'] })
await t('functions-bulk-delete (allowed)', 200, bd)

console.log('\n--- RESULTS ---')
console.log(results.join('\n'))
console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)