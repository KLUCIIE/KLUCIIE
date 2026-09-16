import crypto from 'node:crypto'

const OTP_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const OTP_BASE = 34n
const OTP_DIGITS = 6

/** HMAC-SHA1 rotating code, mirrors frontend `rotatingCode()` / SQL `registration_otp_at()`. */
export function registrationOtp(secret: string, back = 0): string {
  const counter = Math.floor(Date.now() / 1000 / 60) - back
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter), 0)
  const h = crypto.createHmac('sha1', secret).update(msg).digest()
  const offset = h[h.length - 1] & 0x0f
  const bin =
    ((h[offset] & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) << 8) |
    (h[offset + 3] & 0xff)
  let value = BigInt(bin) % OTP_BASE ** BigInt(OTP_DIGITS)
  let out = ''
  for (let i = 0; i < OTP_DIGITS; i++) {
    out = OTP_ALPHABET[Number(value % OTP_BASE)] + out
    value = value / OTP_BASE
  }
  return out
}

/** Signed, window-tagged token proving validate_role_registration passed (migration 0008). */
export function registrationToken(slug: string, email: string, window: number, signingSecret: string): string {
  return crypto.createHmac('sha256', signingSecret).update(`${slug}|${email.toLowerCase()}|${window}`).digest('hex')
}

/** Verify a token issued by validate_role_registration. Accepts the current and previous minute window. */
export function verifyRegistrationToken(slug: string, email: string, token: string, signingSecret: string): boolean {
  if (!token) return false
  const window = Math.floor(Date.now() / 1000 / 60)
  return (
    token === registrationToken(slug, email, window, signingSecret) ||
    token === registrationToken(slug, email, window - 1, signingSecret)
  )
}
