import { generateRecoveryCodes, sha256Hash } from '../utils/codes.js'
import { db } from '../db/index.js'
import { adminRecoveryCodes } from '../db/schema.js'
import { eq, and, isNull } from 'drizzle-orm'

export async function createRecoveryCodes(adminId: string): Promise<string[]> {
  const codes = generateRecoveryCodes(10)
  const hashedCodes = codes.map((code) => ({
    adminId,
    codeHash: sha256Hash(code),
  }))

  await db.insert(adminRecoveryCodes).values(hashedCodes)
  return codes
}

export async function saveRecoveryCodes(adminId: string, codes: string[]): Promise<string[]> {
  const hashedCodes = codes.map((code) => ({
    adminId,
    codeHash: sha256Hash(String(code)),
  }))
  await db.insert(adminRecoveryCodes).values(hashedCodes)
  return codes
}

export async function useRecoveryCode(adminId: string, code: string, ip?: string): Promise<boolean> {
  const codeHash = sha256Hash(code)
  const record = await db.query.adminRecoveryCodes.findFirst({
    where: and(
      eq(adminRecoveryCodes.adminId, adminId),
      eq(adminRecoveryCodes.codeHash, codeHash),
      isNull(adminRecoveryCodes.usedAt),
    ),
  })

  if (!record) return false

  await db
    .update(adminRecoveryCodes)
    .set({ usedAt: new Date(), usedIp: ip })
    .where(eq(adminRecoveryCodes.id, record.id))

  return true
}
