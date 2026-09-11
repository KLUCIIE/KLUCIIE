import postgres from 'postgres'

const sql = postgres('postgresql://postgres:postgres@localhost:5432/kl_ciie')
for (const t of ['events', 'attendance', 'event_member_qr_codes', 'event_round_windows']) {
  const cols = await sql.unsafe(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [t],
  )
  console.log(`\n${t}: ${cols.map((c) => `${c.column_name}:${c.data_type}${c.column_default ? '*' : ''}`).join(', ')}`)
}
await sql.end()