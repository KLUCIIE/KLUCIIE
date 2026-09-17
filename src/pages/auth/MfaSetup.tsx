import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Download, KeyRound, QrCode, ShieldCheck } from 'lucide-react'
import { Button, Spinner, TextInput } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { generateRecoveryCodes, recoveryCodesText } from '@/lib/recovery'
import { downloadTextFile, errorMessage } from '@/lib/utils'

type Step = 'intro' | 'enroll' | 'recovery' | 'done'

export default function MfaSetup() {
  const { user, profile, mfa, markAdminMfaVerified, refreshProfile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('intro')
  const [qrData, setQrData] = useState('')
  const [secret, setSecret] = useState('')
  const [factorId, setFactorId] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [codes, setCodes] = useState<string[]>([])
  const [recoverySaved, setRecoverySaved] = useState(false)

  // Already fully set up? Get out of here.
  useEffect(() => {
    if (mfa && mfa.hasVerifiedFactor && profile && profile.mfa_setup_required) {
      supabase.from('profiles').update({ mfa_enabled: true, mfa_setup_required: false }).eq('id', user!.id).then(() => {
        refreshProfile()
        markAdminMfaVerified()
        navigate('/admin', { replace: true })
      })
      return
    }
    if (mfa && mfa.aal === 'aal2' && profile && !profile.mfa_setup_required && profile.role === 'super_admin') {
      navigate('/admin', { replace: true })
    }
  }, [mfa, profile, navigate])

  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin || profile?.role !== 'super_admin') return <Navigate to="/dashboard" replace />

  const beginEnroll = async () => {
    setBusy(true)
    setError('')
    try {
      const { data: existing } = await supabase.auth.mfa.listFactors()
      for (const f of existing?.totp ?? []) {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'CIIE Authenticator' })
      if (err || !data) {
        setError(errorMessage(err))
        setBusy(false)
        return
      }
      setFactorId(data.id)
      setQrData(data.totp.qr_code)
      const secretMatch = data.totp.uri.match(/secret=([A-Za-z0-9]+)/)
      setSecret(data.totp.secret || (secretMatch ? secretMatch[1] : ''))
      setStep('enroll')
    } catch (e) {
      setError(errorMessage(e))
    }
    setBusy(false)
  }

  const verify = async (e: FormEvent) => {
    e.preventDefault()
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setBusy(true)
    setError('')
    const { data, error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim(), purpose: 'enroll' })
    if (err || !data) {
      setError(`Verification failed: ${errorMessage(err)}`)
      await supabase.rpc('log_admin_event', {
        p_action: 'MFA Failure',
        p_entity_type: 'admin',
        p_entity_id: user.id,
      })
      setBusy(false)
      return
    }
    await supabase.rpc('log_admin_event', {
      p_action: 'MFA Verification',
      p_entity_type: 'admin',
      p_entity_id: user.id,
    })
    // Unenroll any other verified TOTP factors (fresh factor is now current).
    const { data: factors } = await supabase.auth.mfa.listFactors()
    for (const f of factors?.totp ?? []) {
      if (f.id !== factorId && f.status === 'verified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
    }

    const generated = generateRecoveryCodes(8)
    const { error: rpcErr } = await supabase.rpc('generate_recovery_codes', { p_codes: generated })
    if (rpcErr) {
      setError('MFA verified, but recovery codes could not be stored. Contact your Super Admin.')
      setBusy(false)
      return
    }
    setCodes(generated)
    await supabase.rpc('log_admin_event', {
      p_action: 'MFA Setup',
      p_entity_type: 'admin',
      p_entity_id: user.id,
    })
    setStep('recovery')
    setBusy(false)
  }

  const complete = async () => {
    setBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({ mfa_enabled: true, mfa_setup_required: false })
      .eq('id', user.id)
    setBusy(false)
    if (error) {
      setError(errorMessage(error))
      return
    }
    await refreshProfile()
    markAdminMfaVerified()
    setStep('done')
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-600">
            <ShieldCheck size={26} />
          </div>
          <h1 className="text-2xl font-black">Secure Your CIIE Admin Account</h1>
          <p className="mt-1 text-sm text-slate-400">
            Two-factor authentication is required before you can access the Admin Dashboard.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-2xl">
          {step === 'intro' && (
            <div>
              <ol className="space-y-3 text-sm text-slate-700">
                {[
                  'Set up an authenticator app',
                  'Scan the QR code (or enter the secret manually)',
                  'Enter the 6-digit verification code',
                  'Verify',
                  'Generate recovery codes',
                  'MFA enabled',
                ].map((s, i) => (
                  <li key={s} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Works with Google Authenticator, Authy, Microsoft Authenticator and other TOTP apps.
              </p>
              {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <Button className="mt-5 w-full" onClick={beginEnroll} disabled={busy}>
                {busy ? <Spinner className="border-white/40 border-t-white" /> : <>Begin MFA setup <KeyRound size={16} /></>}
              </Button>
            </div>
          )}

          {step === 'enroll' && (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <QrCode size={18} /> Scan with your authenticator app
              </h2>
              <div className="mt-4 flex justify-center">
                {qrData && <img src={qrData} alt="MFA QR code" className="h-56 w-56 rounded-xl border border-slate-200" />}
              </div>
              <div className="mt-4">
                <p className="text-xs font-medium text-slate-400">Or enter this secret manually:</p>
                <p className="mt-1 break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">{secret}</p>
              </div>

              <form onSubmit={verify} className="mt-4">
                <label className="label">6-digit verification code</label>
                <TextInput
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  placeholder="000000"
                  className="text-center font-mono text-lg tracking-widest"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
                {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                <Button type="submit" className="mt-4 w-full" disabled={busy}>
                  {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Verify'}
                </Button>
              </form>
            </div>
          )}

          {step === 'recovery' && (
            <div>
              <h2 className="text-lg font-bold text-slate-900">Recovery Codes</h2>
              <p className="mt-1 text-sm text-slate-500">
                Save these now. Each code can be used once if you ever lose your authenticator app.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-900 p-4">
                {codes.map((c) => (
                  <code key={c} className="text-center font-mono text-sm font-bold tracking-widest text-green-400">
                    {c}
                  </code>
                ))}
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    downloadTextFile('ciie-recovery-codes.txt', recoveryCodesText(codes))
                    setRecoverySaved(true)
                  }}
                >
                  <Download size={15} /> Download Recovery Codes
                </Button>
                {!recoverySaved && (
                  <p className="text-xs text-slate-400">Tip: download or write these down — they won't be shown again.</p>
                )}
                <Button className="w-full" onClick={complete} disabled={busy}>
                  {busy ? <Spinner className="border-white/40 border-t-white" /> : 'MFA enabled — Continue to Admin Dashboard'}
                </Button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600">
                <ShieldCheck size={26} />
              </div>
              <h2 className="text-xl font-bold text-slate-900">MFA enabled</h2>
              <p className="mt-1 text-sm text-slate-500">Your admin account is now protected.</p>
              <Link to="/admin" className="btn-primary mt-5 w-full">
                Continue to Admin Dashboard
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
