import crypto from 'node:crypto'

export function generateOtp(length = 6): string {
  let otp = ''
  for (let i = 0; i < length; i++) {
    otp += crypto.randomInt(0, 10).toString()
  }
  return otp
}

export function sha256Hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

export function generateCiieId(year: number, sequence: number): string {
  return `CIIE${year}${sequence.toString().padStart(5, '0')}`
}

export function generateRegistrationCode(): string {
  const year = new Date().getFullYear()
  const seq = crypto.randomInt(100000, 999999)
  return `REG-${year}-${seq}`
}

export function generateCertificateCode(): string {
  const year = new Date().getFullYear()
  const seq = crypto.randomInt(100000, 999999)
  return `CERT-${year}-${seq}`
}

export function generateQrCode(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(4).toString('hex').toUpperCase())
  }
  return codes
}
