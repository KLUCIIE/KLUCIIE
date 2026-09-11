import { randomUUID } from 'node:crypto'
import { pgClient as c } from '../src/db/index.js'
import { generateQrCode, generateCiieId } from '../src/utils/codes.js'

// 1) cleanup my promote-test rows
await c.unsafe(`DELETE FROM join_applications WHERE email LIKE 'promote-test-%@gmail.com'`)
await c.unsafe(`DELETE FROM profiles WHERE email LIKE 'promote-test-%@gmail.com'`)
await c.unsafe(`DELETE FROM profiles WHERE email LIKE 'live-test-%@kluniversity.in'`)
console.log('cleaned test rows')

// 2) promote the real pending application
const apps = await c.unsafe(`SELECT id, email, full_name, student_id, phone, department, year_of_study, fields FROM join_applications WHERE email = 'sucesskart.edtech@gmail.com'`)
const app = apps[0]
if (!app) { console.log('no join app for sucesskart'); process.exit(0) }

const prof = await c.unsafe(`SELECT id FROM profiles WHERE email = $1`, [app.email])
let pid = prof[0]?.id ?? null
if (!pid) {
  const year = new Date().getFullYear()
  const last = await c.unsafe(`SELECT ciie_id FROM profiles WHERE ciie_id ~ $1 ORDER BY ciie_id DESC LIMIT 1`, [`^CIIE${year}[0-9]{5}$`])
  const m = last[0]?.ciie_id?.match(/(\d{5})$/)
  const seq = m ? parseInt(m[1], 10) + 1 : 1
  pid = randomUUID()
  const ciieId = generateCiieId(year, seq)
  await c.unsafe(`
    INSERT INTO profiles (id, email, full_name, ciie_id, student_id, phone, department, year_of_study, role, status, is_listed_member, skills, social_links, custom_fields, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'member','recruit',false,'{}'::text[],'{}'::jsonb,'{}'::jsonb, now(), now())`,
    [pid, app.email, app.full_name, ciieId, app.student_id, app.phone, app.department, app.year_of_study])
  await c.unsafe(`INSERT INTO member_qr_codes (member_id, code) VALUES ($1,$2)`, [pid, generateQrCode()])
  await c.unsafe(`INSERT INTO member_privacy_settings (member_id) VALUES ($1)`, [pid])
  console.log('profile created', ciieId)
} else {
  console.log('profile exists', pid)
}

const ra = await c.unsafe(`SELECT id FROM recruit_applications WHERE email = $1`, [app.email])
if (!ra[0]) {
  await c.unsafe(`
    INSERT INTO recruit_applications (member_id, email, full_name, student_id, phone, department, year_of_study, join_fields, stage, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'gd', now(), now())`,
    [pid, app.email, app.full_name, app.student_id, app.phone, app.department, app.year_of_study, JSON.stringify(app.fields ?? {})])
  console.log('recruit_application created')
} else {
  console.log('recruit_application exists')
}

await c.end().catch(() => {})
process.exit(0)