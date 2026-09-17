import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { Button, Spinner, TextInput } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

export default function MfaVerify() {
  const { user, profile, mfa, adminMfaVerified, markAdminMfaVerified, refreshProfile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [mode, setMode] = useState<'code' | 'recovery'>('code')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!user || !profile || !isAdmin || profile.role !== 'super_admin') return <Navigate to="/login" replace />
  if (mfa && mfa.aal === 'aal2' && adminMfaVerified) return <Navigate to="/admin" replace />
  if (mfa && !mfa.hasVerifiedFactor) return <Navigate to="/auth/mfa-setup" replace />

  const submitCode = async (e: FormEvent) => {
    e.preventDefault()
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setBusy(true)
    setError('')
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const totp = factors?.totp?.find((f) => f.status === 'verified')
    if (!totp) {
      setError('No authenticator factor found. Set up MFA again.')
      setBusy(false)
      return
    }
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code: code.trim(), purpose: 'login' })
    if (err) {
      setError('Invalid verification code.')
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
    markAdminMfaVerified()
    await refreshProfile()
    navigate('/admin', { replace: true })
  }

  const submitRecovery = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { data, error: err } = await supabase.rpc('use_recovery_code', { p_code: recoveryCode.trim() })
    if (err || !data) {
      setError('Invalid or already-used recovery code.')
      setBusy(false)
      return
    }
    // Recovery codes stand in for the authenticator: require a fresh factor now.
    navigate('/auth/mfa-setup', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-600">
            <ShieldCheck size={26} />
          </div>
          <h1 className="text-2xl font-black">Two-factor verification</h1>
          <p className="mt-1 text-sm text-slate-400">Enter a code from your authenticator app to continue.</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-2xl">
          {mode === 'code' ? (
            <form onSubmit={submitCode}>
              <label className="label">6-digit code</label>
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
              <button type="button" onClick={() => setMode('recovery')} className="mt-3 w-full text-center text-sm font-medium text-primary-600 hover:underline">
                Use Recovery Code
              </button>
            </form>
          ) : (
            <form onSubmit={submitRecovery}>
              <div className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
                <KeyRound size={15} /> Recovery code
              </div>
              <p className="mb-3 text-xs text-slate-400">
                Each code works once. Using one will require you to set up a fresh authenticator factor.
              </p>
              <TextInput
                placeholder="XXXX-XXXX"
                className="text-center font-mono tracking-widest"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
              />
              {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <Button type="submit" className="mt-4 w-full" disabled={busy} variant="secondary">
                {busy ? <Spinner /> : 'Use recovery code'}
              </Button>
              <button type="button" onClick={() => setMode('code')} className="mt-3 w-full text-center text-sm font-medium text-primary-600 hover:underline">
                Back to authenticator code
              </button>
            </form>
          )}

          <p className="mt-4 text-center text-xs text-slate-400">
            Trouble logging in? Contact your Super Admin.
          </p>
        </div>
      </div>
    </div>
  )
}
