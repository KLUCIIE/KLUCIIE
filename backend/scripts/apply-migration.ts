import postgres from 'postgres'
import { readFileSync, readdirSync } from 'fs'

const sql = postgres('postgresql://postgres:postgres@localhost:5432/kl_ciie')
const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()
for (const f of files) {
  if (!process.argv[2] || f.includes(process.argv[2])) {
    await sql.unsafe(readFileSync(`migrations/${f}`, 'utf8'))
    console.log('applied', f)
  }
}
await sql.end()