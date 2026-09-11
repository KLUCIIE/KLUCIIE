const BASE = 'http://localhost:3001'
const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nani@kluniversity.in', password: 'Nani@SuperAdmin@9989' }) })
const j = await r.json()
if (!r.ok) throw new Error(JSON.stringify(j))
const pipe = await fetch(`${BASE}/api/rpc/get_recruit_applications`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${j.accessToken}` }, body: '{}' })
const rows = ((await pipe.json()).data ?? []) as any[]
console.log('total pipeline rows:', rows.length)
for (const x of rows) console.log(`${x.email} | ${x.full_name} | stage=${x.stage} | ciie=${x.ciie_id}`)
process.exit(0)