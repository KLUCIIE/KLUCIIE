import * as OTPAuth from 'otpauth'

export interface TotpSetup {
  uri: string
  secret: string
}

export function generateTotpSecret(email: string, issuer = 'KL CIIE'): TotpSetup {
  const totp = new OTPAuth.TOTP({
    issuer,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret({ size: 20 }),
  })
  return {
    uri: totp.toString(),
    secret: totp.secret.base32,
  }
}

export function verifyTotp(secret: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  })
  const delta = totp.validate({ token, window: 1 })
  return delta !== null
}
