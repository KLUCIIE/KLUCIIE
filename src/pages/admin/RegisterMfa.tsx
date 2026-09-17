import { useState, type FormEvent } from 'react'
import { Download, KeyRound, QrCode, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Badge, Button, PageHeader, Spinner, TextInput } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { generateRecoveryCodes, recoveryCodesText } from '@/lib/recovery'
import { downloadTextFile, errorMessage } from '@/lib/utils'

type Step = 'idle' | 'enroll' | 'recovery'

export default function RegisterMfa() {
  const { user, profile, mfa, isSuperAdmin, refreshProfile, markAdminMfaVerified } = useAuth()
  const [step, setStep] = useState<Step>('idle')
  const [qrData, setQrData] = useState('')
  const [secret, setSecret] = useState('')
  const [factorId, setFactorId] = useState('')
  const [code, setCode] = useState('')
  const [testCode, setTestCode] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [recoverySaved, setRecoverySaved] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [testOutcome, setTestOutcome] = useState<'ok' | 'fail' | null>(null)

  if (!isSuperAdmin || profile?.role !== 'super_admin') {
    return (
      <div>
        <PageHeader title="Register MFA" subtitle="Set up and manage two-factor authentication for your admin account." />
        <div className="card flex items-center gap-3 p-6 text-sm text-slate-500">
          <ShieldAlert size={18} className="shrink-0 text-amber-500" />
          Only a Super Admin can set up and use MFA for their account.
        </div>
      </div>
    )
  }

  const configured = !!mfa?.hasVerifiedFactor

  const beginEnroll = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    setTestOutcome(null)
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

  const verifySetup = async (e: FormEvent) => {
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
      await supabase.rpc('log_admin_event', { p_action: 'MFA Failure', p_entity_type: 'admin', p_entity_id: user!.id })
      setBusy(false)
      return
    }
    await supabase.rpc('log_admin_event', { p_action: 'MFA Verification', p_entity_type: 'admin', p_entity_id: user!.id })
    // Unenroll any other verified TOTP factors (the fresh factor is now current).
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
    await supabase.rpc('log_admin_event', { p_action: 'MFA Setup', p_entity_type: 'admin', p_entity_id: user!.id })
    setStep('recovery')
    setBusy(false)
  }

  const complete = async () => {
    setBusy(true)
    setError('')
    const { error } = await supabase
      .from('profiles')
      .update({ mfa_enabled: true, mfa_setup_required: false })
      .eq('id', user!.id)
    if (error) {
      setBusy(false)
      setError(errorMessage(error))
      return
    }
    await refreshProfile()
    markAdminMfaVerified()
    setStep('idle')
    setBusy(false)
    setNotice('MFA is now enabled on your account. You will be asked to verify a code each time you open the Admin Console.')
  }

  const testAuthenticator = async (e: FormEvent) => {
    e.preventDefault()
    if (testCode.trim().length !== 6) {
      setTestOutcome('fail')
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setTestBusy(true)
    setTestOutcome(null)
    setError('')
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const totp = factors?.totp?.find((f) => f.status === 'verified')
    if (!totp) {
      setTestBusy(false)
      setTestOutcome('fail')
      setError('No verified authenticator factor found. Set up MFA again.')
      return
    }
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code: testCode.trim(), purpose: 'login' })
    if (err) {
      setTestBusy(false)
      setTestOutcome('fail')
      setError(`Verification failed: ${errorMessage(err)}`)
      await supabase.rpc('log_admin_event', { p_action: 'MFA Failure', p_entity_type: 'admin', p_entity_id: user!.id })
      return
    }
    await supabase.rpc('log_admin_event', { p_action: 'MFA Verification', p_entity_type: 'admin', p_entity_id: user!.id })
    markAdminMfaVerified()
    await refreshProfile()
    setTestBusy(false)
    setTestOutcome('ok')
    setTestCode('')
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Register MFA" subtitle="Set up, test and manage two-factor authentication for your admin account." />

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          <ShieldCheck size={16} className="mt-0.5 shrink-0" /> {notice}
        </p>
      )}

      <div className="card mb-5 flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
            <ShieldCheck size={18} />
          </span>
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
              Two-factor authentication
              <Badge tone={configured ? 'green' : 'amber'}>{configured ? 'MFA active' : 'MFA not set up'}</Badge>
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {profile?.mfa_setup_required && <span className="mr-2 text-amber-600">Setup required.</span>}
              AAL level: <span className="font-mono">{mfa?.aal ?? 'aal1'}</span> • verified factors:{' '}
              <span className="font-mono">{mfa?.verifiedTotpFactors.length ?? 0}</span>
            </p>
          </div>
        </div>
      </div>

      {step === 'enroll' ? (
        <div className="card p-6">
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

          <form onSubmit={verifySetup} className="mt-4">
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
            <Button type="submit" className="mt-4 w-full" disabled={busy}>
              {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Verify & continue'}
            </Button>
          </form>
        </div>
      ) : step === 'recovery' ? (
        <div className="card p-6">
          <h2 className="text-lg font-bold text-slate-900">Recovery Codes</h2>
          <p className="mt-1 text-sm text-slate-500">Save these now. Each code can be used once if you ever lose your authenticator app.</p>
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
            {!recoverySaved && <p className="text-xs text-slate-400">Tip: download or write these down — they won't be shown again.</p>}
            <Button className="w-full" onClick={complete} disabled={busy}>
              {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Finish — MFA is now active'}
            </Button>
          </div>
        </div>
      ) : !configured ? (
        <div className="card p-6">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <KeyRound size={16} className="text-primary-600" /> Set up MFA
          </h2>
          <ol className="mt-3 space-y-3 text-sm text-slate-700">
            {[
              'Set up an authenticator app',
              'Scan the QR code (or enter the secret manually)',
              'Enter the 6-digit verification code',
              'Save your recovery codes',
              'MFA enabled — you will verify a code every time you open the Admin Console',
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
          <Button className="mt-5 w-full" onClick={beginEnroll} disabled={busy}>
            {busy ? <Spinner className="border-white/40 border-t-white" /> : <>Begin MFA setup <KeyRound size={16} /></>}
          </Button>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="card p-6">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <ShieldCheck size={16} className="text-primary-600" /> Test my authenticator
            </h2>
            <p className="mt-1 text-xs text-slate-400">Verify that your authenticator app is working with a live code.</p>
            <form onSubmit={testAuthenticator} className="mt-4">
              <TextInput
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                className="text-center font-mono text-lg tracking-widest"
                value={testCode}
                onChange={(e) => {
                  setTestCode(e.target.value.replace(/\D/g, ''))
                  setTestOutcome(null)
                }}
              />
              {testOutcome === 'ok' && (
                <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Code verified — your authenticator is working.</p>
              )}
              {testOutcome === 'fail' && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">That code did not verify. Check your authenticator and try again.</p>
              )}
              <Button type="submit" className="mt-3 w-full" disabled={testBusy}>
                {testBusy ? <Spinner /> : 'Verify code'}
              </Button>
            </form>
          </div>

          <div className="card p-6">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <RefreshCw size={16} className="text-primary-600" /> Reconfigure MFA
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Replace your existing authenticator factor. Your old factor and recovery codes are revoked, and new recovery codes are generated.
            </p>
            <Button variant="secondary" className="mt-4 w-full" onClick={beginEnroll} disabled={busy}>
              {busy ? <Spinner /> : <>Re-register MFA <RefreshCw size={15} /></>}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}