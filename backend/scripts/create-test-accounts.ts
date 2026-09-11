import postgres from 'postgres'
import { genSaltSync, hashSync } from 'bcrypt'
import crypto from 'node:crypto'

const PASSWORD = 'Nani@SuperAdmin@9989'

const accounts = [
  { email: 'nani@kluniversity.in', fullName: 'Nani', role: 'super_admin', ciieId: 'CIIE2026N0001' },
  { email: 'member@kluniversity.in', fullName: 'Nani Member', role: 'member_ciie', ciieId: 'CIIE2026N0002' },
  { email: 'user@kluniversity.in', fullName: 'Nani User', role: 'user', ciieId: 'CIIE2026N0003' },
]

const sql = postgres('postgresql://postgres:postgres@localhost:5432/kl_ciie')
const passHash = hashSync(PASSWORD, genSaltSync(10))

for (const a of accounts) {
  const existing = await sql.unsafe('SELECT id, role FROM profiles WHERE email = $1', [a.email])
  if (existing.length) {
    console.log(`${a.email} exists (role=${existing[0].role}) - skipping`)
    continue
  }
  const [row] = await sql.unsafe(
    `INSERT INTO profiles (id, email, full_name, role, status, mfa_enabled, custom_fields, ciie_id, is_listed_member)
     VALUES ($1, $2, $3, $4, 'active', false, $5::jsonb, $6, false)
     RETURNING id, email, role`,
    [crypto.randomUUID(), a.email, a.fullName, a.role, JSON.stringify({ password_hash: passHash }), a.ciieId],
  )
  if (a.role === 'member_ciie') {
    const code = crypto.randomBytes(32).toString('hex')
    await sql.unsafe('INSERT INTO member_qr_codes (member_id, code) VALUES ($1, $2)', [row.id, code])
  }
  console.log(`created ${row.email} (${row.role})`)
}
await sql.end()