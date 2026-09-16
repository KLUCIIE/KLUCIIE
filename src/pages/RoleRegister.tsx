import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { KeyRound, MailCheck, RefreshCw, ShieldCheck, Timer } from 'lucide-react'
import { Button, Field, PageLoader, Spinner, TextInput } from '@/components/ui'
import { OAuthDomainNotice } from '@/components/OAuthDomainNotice'
import { CustomFieldInputs, missingFields } from '@/components/RegistrationFormFields'
import { useAuth } from '@/hooks/useAuth'
import { useOAuth } from '@/hooks/useOAuth'
import { useSettings, signupDeadlinePassed } from '@/hooks/useSettings'
import RegistrationsClosed from '@/components/RegistrationsClosed'
import { formatWait, useEmailCooldown, type EmailSendStatus } from '@/hooks/useEmailCooldown'
import { apiOrigin, supabase } from '@/lib/supabase'
import type { CustomFieldDef } from '@/lib/types'
import { emailInvokeMessage, errorMessage, isValidTenDigit } from '@/lib/utils'
import PhoneInput from '@/components/PhoneInput'

const BASE_FIELDS: CustomFieldDef[] = [
  { key: 'phone', label: 'Phone number', type: 'text', required: true },
  { key: 'department', label: 'Department / Branch', type: 'text', required: true },
]

export default function RoleRegister({ slug: slugProp, hideStudentId = false }: { slug?: string; hideStudentId?: boolean } = {}) {
  const params = useParams<{ slug: string }>()
  const slug = slugProp ?? params.slug
  const [searchParams] = useSearchParams()
  const msToken = slug === 'user' ? (searchParams.get('ms_token') ?? null) : null
  const msEmail = slug === 'user' ? (searchParams.get('ms_email') ?? '') : ''
  const msName = slug === 'user' ? (searchParams.get('ms_name') ?? '') : ''
  const ghToken = slug === 'user' ? (searchParams.get('gh_token') ?? null) : null
  const ghEmail = slug === 'user' ? (searchParams.get('gh_email') ?? '') : ''
  const ghName = slug === 'user' ? (searchParams.get('gh_name') ?? '') : ''
  const { signUp, refreshProfile } = useAuth()
  const settings = useSettings()
  const oauth = useOAuth()
  const navigate = useNavigate()

  const [info, setInfo] = useState<{ label: string; role: string; enabled: boolean; requires_keys: boolean; fields: CustomFieldDef[] } | null>(null)
  const [loading, setLoading] = useState(true)

  const [fullName, setFullName] = useState(ghName || msName)
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState(ghEmail || msEmail)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [staticKey, setStaticKey] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})

  const [step, setStep] = useState<'form' | 'otp'>('form')
  const [otpCode, setOtpCode] = useState('')
  const [validated, setValidated] = useState<{ token: string; role: string; label: string } | null>(null)

  const { status: otpStatus, remaining: otpRemaining, refresh: refreshOtpStatus } = useEmailCooldown(step === 'otp' ? email.trim() : null)
  const otpLocked = otpStatus?.locked === true

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpNotice, setOtpNotice] = useState('')
  const [otpBusy, setOtpBusy] = useState(false)
  const [resendBusy, setResendBusy] = useState(false)
  const [oauthStarting, setOauthStarting] = useState<'microsoft' | 'github' | null>(null)
  const [domainNotice, setDomainNotice] = useState<'microsoft' | 'github' | null>(null)

  useEffect(() => {
    const onShow = () => setOauthStarting(null)
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  useEffect(() => {
    if (!oauthStarting) return
    const t = setTimeout(() => setOauthStarting(null), 5000)
    return () => clearTimeout(t)
  }, [oauthStarting])

  useEffect(() => {
    if (!slug) return
    let active = true
    setLoading(true)
    setLoadError('')
    supabase.rpc('get_registration_role', { p_slug: slug }).then(({ data, error }) => {
      if (!active) return
      if (error) {
        setLoadError(error.message)
        setLoading(false)
        return
      }
      const d = (data as { label: string; role: string; enabled: boolean; requires_keys: boolean; fields: CustomFieldDef[] } | null) ?? null
      setInfo(d)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [slug])

  if (loading) return <PageLoader />
  if (!info || !info.enabled) {
    return (
      <div className="container-page py-20 text-center">
        <p className="text-lg font-semibold text-slate-900">Registration page not available</p>
        <p className="mt-1 text-sm text-slate-500">This role's registration page is disabled or does not exist.</p>
        {loadError && (
          <p className="mx-auto mt-3 max-w-md rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
        )}
        <Link to="/register" className="btn-primary mt-4">
          View registration options
        </Link>
      </div>
    )
  }

  if (signupDeadlinePassed(settings)) {
    return (
      <>
        <div className="container-page max-w-3xl py-12">
          <div className="card p-8 text-center">
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">Registrations are closed</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
              Account registration is closed — the registration deadline has passed.
            </p>
            <Link to="/login" className="btn-primary mt-6 inline-block">
              Log in instead
            </Link>
          </div>
        </div>
        <RegistrationsClosed onClose={() => navigate('/')} />
      </>
    )
  }

  const roleExtras: CustomFieldDef[] = (info.fields ?? []).filter(
    (f) => !['phone', 'department', 'year_of_study'].includes(f.key),
  )
  const adminExtras = (settings.register_fields ?? []).filter(
    (f) => f.key?.trim() && !roleExtras.some((b) => b.key === f.key),
  )
  const extraFields: CustomFieldDef[] = [...roleExtras, ...adminExtras]
  const fields: CustomFieldDef[] = [...BASE_FIELDS, ...extraFields]
  const purpose = `role:${slug}`

  const msEnabled = slug === 'user' && oauth.enabled && oauth.configured && ['microsoft', 'both', 'microsoft-only', 'microsoft+github-only'].includes(oauth.mode)
  const ghEnabled = slug === 'user' && oauth.enabled && oauth.configured && ['github', 'both', 'github-only', 'microsoft+github-only'].includes(oauth.mode)
  const msOnly = oauth.mode === 'microsoft-only'
  const ghOnly = oauth.mode === 'github-only'
  const bothOnly = oauth.mode === 'microsoft+github-only'
  const exclusive = msOnly || ghOnly || bothOnly

  const isMsSignup = msEnabled && !!msToken
  const isGhSignup = ghEnabled && !!ghToken
  const startMicrosoft = () => {
    if (settings.signup_domain_restriction && !!settings.signup_allowed_domains?.length) {
      setDomainNotice('microsoft')
      return
    }
    setOauthStarting('microsoft')
    window.location.href = `${apiOrigin}/api/oauth/microsoft/authorize?from=register`
  }
  const startGitHub = () => {
    if (settings.signup_domain_restriction && !!settings.signup_allowed_domains?.length) {
      setDomainNotice('github')
      return
    }
    setOauthStarting('github')
    window.location.href = `${apiOrigin}/api/oauth/github/authorize?from=register`
  }

  const sendOtp = async (toEmail: string) => {
    const { error: mailErr } = await supabase.functions.invoke('send-recruit-email', {
      body: { kind: 'registration-otp', purpose, to_email: toEmail, full_name: fullName.trim() },
    })
    if (mailErr) {
      const msg = `We couldn't email the verification code. ${await emailInvokeMessage(mailErr)}`
      setOtpError(msg)
      alert(msg)
      return false
    }
    setOtpError('')
    return true
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (!fullName.trim()) {
      setError('Please enter your full name.')
      return
    }

    if (isGhSignup) {
      setBusy(true)
      try {
        const res = await fetch(`${apiOrigin}/api/oauth/github/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: ghToken,
            fullName: fullName.trim(),
            password,
          }),
        })
        const data = (await res.json().catch(() => null)) as {
          accessToken?: string
          refreshToken?: string
          user?: Record<string, unknown>
          message?: string
        } | null
        if (!res.ok || !data?.accessToken) {
          setBusy(false)
          setError(data?.message ?? 'Could not create your account. Please try again.')
          return
        }
        await supabase.auth.setOAuthSession({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? '',
          user: data.user ?? {},
        })
        await refreshProfile()
        navigate('/complete-profile')
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setBusy(false)
      }
      return
    }

    const missing = missingFields(fields, values)
    if (missing) {
      setError(missing)
      return
    }
    if (!hideStudentId && !isValidTenDigit(studentId)) {
      setError('Student ID is required and must be exactly 10 digits.')
      return
    }

    const domain = email.trim().split('@').pop()?.toLowerCase()
    if (settings.signup_domain_restriction) {
      const allowed = (settings.signup_allowed_domains ?? [])
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean)
      if (!domain || !allowed.some((d) => domain === d || domain.endsWith('.' + d))) {
        setError(`Registration is limited to ${allowed.map((d) => `@${d}`).join(', ')} email addresses.`)
        return
      }
    }

    setBusy(true)
    const { data, error: valErr } = await supabase.rpc('validate_role_registration', {
      p_slug: slug,
      p_static_key: staticKey.trim(),
      p_code: mfaCode.trim(),
      p_email: email.trim(),
    })
    const res = data as { valid?: boolean; error?: string | null; token?: string; role?: string; label?: string } | null
    if (valErr || !res?.valid) {
      setBusy(false)
      setError(res?.error ?? errorMessage(valErr ?? 'Registration failed'))
      return
    }

    const validatedInfo = { token: res.token ?? '', role: res.role ?? info.role, label: res.label ?? info.label }
    setValidated(validatedInfo)

    if (!settings.signup_email_otp) {
      const meta: Record<string, string> = {
        role: validatedInfo.role,
        role_slug: slug ?? '',
        registration_token: validatedInfo.token,
      }
      if (!hideStudentId) meta.student_id = studentId.trim()
      for (const f of fields) {
        meta[f.key] = (values[f.key] ?? '').trim()
      }
      const sign = await signUp(fullName.trim(), email.trim(), password, meta)
      setBusy(false)
      if (sign.error) {
        setError(sign.error)
        return
      }
      const { data: sessionData } = await supabase.auth.getSession()
      if (sessionData.session) {
        await refreshProfile()
      }
      navigate('/register/role/success', { state: { label: validatedInfo.label, email: email.trim() } })
      return
    }

    // Respect the resend cooldown / 10-hour lockout for this address.
    const throttle = (await supabase.rpc('email_send_status', { p_email: email.trim() })).data as EmailSendStatus | null
    if (throttle?.locked) {
      setBusy(false)
      setError('Too many verification attempts for this email. Please try again after 10 hours.')
      return
    }
    if ((throttle?.wait_seconds ?? 0) > 0) {
      setBusy(false)
      setOtpCode('')
      setOtpNotice(`A 6-digit verification code has been emailed to ${email.trim()}.`)
      setStep('otp')
      return
    }

    const ok = await sendOtp(email.trim())
    setBusy(false)
    if (!ok) return

    setOtpCode('')
    setOtpNotice(`A 6-digit verification code has been emailed to ${email.trim()}.`)
    await refreshOtpStatus(120)
    setStep('otp')
  }

  const verifyOtp = async (e: FormEvent) => {
    e.preventDefault()
    if (!validated) return
    setOtpError('')
    setOtpNotice('')
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setOtpError('Enter the 6-digit code you received by email.')
      return
    }
    setOtpBusy(true)
    const { data, error: err } = await supabase.rpc('verify_email_otp', {
      p_email: email.trim(),
      p_purpose: purpose,
      p_code: otpCode.trim(),
    })
    if (err || !(data as { ok?: boolean } | null)?.ok) {
      setOtpBusy(false)
      setOtpError((data as { error?: string } | null)?.error ?? errorMessage(err ?? 'Verification failed'))
      return
    }

    const meta: Record<string, string> = {
      role: validated.role,
      role_slug: slug ?? '',
      registration_token: validated.token,
    }
    if (!hideStudentId) meta.student_id = studentId.trim()
    for (const f of fields) {
      meta[f.key] = (values[f.key] ?? '').trim()
    }

    const sign = await signUp(fullName.trim(), email.trim(), password, meta)
    setOtpBusy(false)
    if (sign.error) {
      setOtpError(sign.error)
      return
    }
    const { data: sessionData } = await supabase.auth.getSession()
    if (sessionData.session) {
      await refreshProfile()
    }
    navigate('/register/role/success', { state: { label: validated.label, email: email.trim() } })
  }

  const resend = async () => {
    setOtpError('')
    setOtpNotice('')
    setResendBusy(true)
    const ok = await sendOtp(email.trim())
    setResendBusy(false)
    if (!ok) return
    setOtpNotice(`A fresh verification code has been emailed to ${email.trim()}.`)
    await refreshOtpStatus(120)
  }

  const backToForm = () => {
    setStep('form')
    setOtpError('')
    setOtpNotice('')
    setOtpCode('')
  }

  if (step === 'otp') {
    return (
      <div className="w-full">
        <div className="card p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-600">
              <MailCheck size={24} />
            </div>
            <h1 className="text-xl font-bold text-slate-900">Verify your email</h1>
            <p className="mt-1 text-sm text-slate-500">
              We emailed a 6-digit code to <span className="font-semibold text-slate-700">{email}</span>. Enter it to
              create your account as {info.label}.
            </p>
            <p className="mx-auto mt-2 max-w-md text-xs text-slate-400">
              Didn't receive it? Check your <strong>spam</strong> / <strong>promotions</strong> folder and make sure you
              entered the right email address.
            </p>
          </div>

          <form onSubmit={(e) => void verifyOtp(e)} className="space-y-4">
            <Field label="Verification code" hint="The code expires in 15 minutes.">
              <TextInput
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                className="text-center text-lg tracking-[0.5em]"
              />
            </Field>

            {otpError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{otpError}</p>}
            {otpNotice && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{otpNotice}</p>}
            {otpLocked && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                Too many verification attempts for this email. Please try again after 10 hours.
              </p>
            )}

            <Button type="submit" disabled={otpBusy} className="w-full">
              {otpBusy ? <Spinner className="border-white/40 border-t-white" /> : 'Verify & create my account'}
            </Button>
          </form>

          <div className="mt-5 flex items-center justify-center gap-4">
            <button
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:underline disabled:text-slate-400"
              disabled={resendBusy || otpRemaining > 0 || otpLocked}
              onClick={() => void resend()}
            >
              {resendBusy ? <Spinner className="h-4 w-4" /> : <RefreshCw size={14} />}
              {otpRemaining > 0 ? `Resend code in ${formatWait(otpRemaining)}` : 'Resend code'}
            </button>
            <button className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:underline" onClick={backToForm}>
              Edit details
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="card p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-600">
            <ShieldCheck size={24} />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Register as {info.label}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isMsSignup
              ? 'Almost done — set a password (optional extra login method). We will then take you to complete the rest of your profile.'
              : info.requires_keys
                ? settings.signup_email_otp
                  ? 'You need the registration key and the current one-time code (changes every minute) from the CIIE admin. We will then email a verification code to confirm your email.'
                  : 'You need the registration key and the current one-time code (changes every minute) from the CIIE admin.'
                : settings.signup_email_otp
                  ? 'Create your account. We will email a verification code to confirm your email. No registration key needed.'
                  : 'Create your account. No registration key or email verification needed.'}
          </p>
        </div>

{exclusive && (msEnabled || ghEnabled) && (
          <div className="space-y-4">
            {msEnabled && !msToken && (
              <button
                type="button"
                onClick={startMicrosoft}
                disabled={oauthStarting !== null}
                className="flex w-full cursor-default items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-default disabled:opacity-80 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 hover:dark:bg-slate-700"
              >
                {oauthStarting === 'microsoft' ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    <span className="animate-pulse">Redirecting to Microsoft…</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 23 23" className="h-4 w-4" aria-hidden>
                      <path fill="#f35325" d="M1 1h10v10H1z" />
                      <path fill="#81bc06" d="M12 1h10v10H12z" />
                      <path fill="#05a6f0" d="M1 12h10v10H1z" />
                      <path fill="#ffba08" d="M12 12h10v10H12z" />
                    </svg>
                    Continue with Microsoft
                  </>
                )}
              </button>
            )}
            {ghEnabled && !ghToken && (
              <button
                type="button"
                onClick={startGitHub}
                disabled={oauthStarting !== null}
                className="flex w-full cursor-default items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-default disabled:opacity-80 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 hover:dark:bg-slate-700"
              >
                {oauthStarting === 'github' ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    <span className="animate-pulse">Redirecting to GitHub…</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                    Continue with GitHub
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {(!exclusive || (msOnly && msToken) || (ghOnly && ghToken) || (bothOnly && (msToken || ghToken))) && (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name *">
              <TextInput required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Rahul Kumar" />
            </Field>
            {!hideStudentId && !isMsSignup && (
              <Field label="Student ID *" hint="Exactly 10 digits">
                <TextInput required inputMode="numeric" maxLength={10} value={studentId} onChange={(e) => setStudentId(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="e.g. 2300123456" />
              </Field>
            )}
            <Field label="Email *" hint={settings.signup_domain_restriction ? 'Only KL University email addresses are accepted.' : undefined}>
              <TextInput type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={settings.signup_domain_restriction ? 'you@kluniversity.in' : 'you@example.com'} />
            </Field>
            <Field label="Password *">
              <TextInput type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </Field>
            <Field label="Confirm password *">
              <TextInput type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat password" />
            </Field>
            {!isMsSignup && (
            <div className="sm:col-span-2">
              <Field label="Phone number *" hint="10-digit mobile number">
                <PhoneInput value={values['phone'] ?? ''} onChange={(v) => setValues({ ...values, phone: v })} />
              </Field>
            </div>
          )}
          {!isMsSignup && (
            <Field label="Department / Branch *">
              <TextInput
                required
                value={values['department'] ?? ''}
                onChange={(e) => setValues({ ...values, department: e.target.value })}
                placeholder="Department / Branch"
              />
            </Field>
          )}
          </div>

          {!isMsSignup && extraFields.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="mb-3 text-sm font-bold text-slate-900">Additional details</h3>
              <CustomFieldInputs fields={extraFields} values={values} onChange={setValues} />
            </div>
          )}

          {info.requires_keys && (
            <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-primary-800">
                <KeyRound size={15} /> Registration key &amp; one-time code
              </h3>
              <p className="mt-1 text-xs text-primary-700/80">
                Ask the CIIE admin for the current code — it refreshes every minute.
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Registration key *">
                  <TextInput
                    required
                    value={staticKey}
                    onChange={(e) => setStaticKey(e.target.value)}
                    placeholder="Enter the CIIE registration key"
                    autoComplete="off"
                  />
                </Field>
                <Field label="One-time MFA code *">
                  <TextInput
                    required
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.toUpperCase())}
                    placeholder="6-character code"
                    autoComplete="off"
                    className="!font-mono !tracking-widest"
                  />
                </Field>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-primary-700/70">
                <Timer size={12} /> Codes are alphanumeric and change every 60 seconds.
              </p>
            </div>
          )}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? <Spinner className="border-white/40 border-t-white" /> : isMsSignup ? 'Create my account' : settings.signup_email_otp ? <>Send verification code</> : <>Create my account</>}
          </Button>
        </form>
        )}

        {!exclusive && ((msEnabled && !msToken) || (ghEnabled && !ghToken)) && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              or continue with
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {msEnabled && !msToken && (
                <button
                  type="button"
                  onClick={startMicrosoft}
                  disabled={oauthStarting !== null}
                  className="flex w-full cursor-default items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-default disabled:opacity-80 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 hover:dark:bg-slate-700"
                >
                  {oauthStarting === 'microsoft' ? (
                    <>
                      <Spinner className="h-4 w-4" />
                      <span className="animate-pulse">Redirecting to Microsoft…</span>
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 23 23" className="h-4 w-4" aria-hidden>
                        <path fill="#f35325" d="M1 1h10v10H1z" />
                        <path fill="#81bc06" d="M12 1h10v10H12z" />
                        <path fill="#05a6f0" d="M1 12h10v10H1z" />
                        <path fill="#ffba08" d="M12 12h10v10H12z" />
                      </svg>
                      Continue with Microsoft
                    </>
                  )}
                </button>
              )}
              {ghEnabled && !ghToken && (
                <button
                  type="button"
                  onClick={startGitHub}
                  disabled={oauthStarting !== null}
                  className="flex w-full cursor-default items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-default disabled:opacity-80 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 hover:dark:bg-slate-700"
                >
                  {oauthStarting === 'github' ? (
                    <>
                      <Spinner className="h-4 w-4" />
                      <span className="animate-pulse">Redirecting to GitHub…</span>
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                      </svg>
                      Continue with GitHub
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <OAuthDomainNotice
        open={domainNotice !== null}
        provider={domainNotice ?? 'github'}
        settings={settings}
        onClose={() => setDomainNotice(null)}
        onConfirm={() => {
          const provider = domainNotice
          setDomainNotice(null)
          setOauthStarting(provider)
          window.location.href = `${apiOrigin}/api/oauth/${provider}/authorize?from=register`
        }}
      />
    </div>
  )
}
