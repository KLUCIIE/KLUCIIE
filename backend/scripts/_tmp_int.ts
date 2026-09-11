const BASE = 'http://localhost:3001'
async function login(u: string, p: string) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u, password: p }) })
  const j = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(j))
  return j.accessToken as string
}
const k = (tok: string, m: string, b: any) => ({ method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify(b) })

const nani = await login('nani@kluniversity.in', 'Nani@SuperAdmin@9989')
const pipe = async (tok: string) => (await fetch(`${BASE}/api/rpc/get_recruit_applications`, k(tok, 'POST', {}))).json() as Promise<{ data: any[] }>
const m = (await pipe(nani)).data.find((x: any) => x.email === 'sucesskart.edtech@gmail.com')

const s1 = await fetch(`${BASE}/api/rpc/submit_recruit_evaluation`, k(nani, 'POST', { p_application_id: m.application_id, p_kind: 'interview', p_responses: { '_q1': 'super admin says hire' }, p_remarks: 'nani super admin opinion' }))
console.log('super admin submit:', s1.status, await s1.text())

const d = (await pipe(nani)).data.find((x: any) => x.email === 'sucesskart.edtech@gmail.com')
console.log('interview_evaluations length:', (d.interview_evaluations ?? []).length)
for (const ev of (d.interview_evaluations ?? [])) console.log(`  -> ${ev.evaluator_name} (${ev.evaluator_ciie_id}): ${JSON.stringify(ev.responses)} | ${ev.remarks} | ${ev.submitted_at}`)
process.exit(0)