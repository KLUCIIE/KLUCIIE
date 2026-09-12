import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarCheck, CircleSlash, MailCheck, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useSettings, signupDeadlinePassed } from '@/hooks/useSettings'
import { Button, Field, Spinner, TextInput } from '@/components/ui'
import RegistrationsClosed from '@/components/RegistrationsClosed'
import { CustomFieldInputs, missingFields } from '@/components/RegistrationFormFields'
import type { CustomFieldDef } from '@/lib/types'
import { emailInvokeMessage, errorMessage, isValidTenDigit } from '@/lib/utils'

const DEFAULT_FIELDS: CustomFieldDef[] = [
  { key: 'phone', label: 'Phone number', type: 'text', required: true },
  { key: 'year_of_study', label: 'Year of study', type: 'select', required: true, options: ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', 'Other'] },
  { key: 'department', label: 'Department / Branch', type: 'text', required: true },
]

export default function Signup() {
  const settings = useSettings()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState<{ fullName: string; batch: 1 | 2 | null } | null>(null)
  const [closedOpen, setClosedOpen] = useState(false)

  const deadlinePassed = signupDeadlinePassed(settings)

  const fields = settings.signup_fields && settings.signup_fields.length > 0 ? settings.signup_fields : DEFAULT_FIELDS

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setNotice('')
    const missing = missingFields(fields, values)
    if (missing) {
      setError(missing)
      return
    }
    if (!fullName.trim()) {
      setError('Please enter your full name.')
      return
    }
    if (!isValidTenDigit(studentId)) {
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
    const { data, error: err } = await supabase.rpc('apply_to_ciie', {
      p_full_name: fullName.trim(),
      p_email: email.trim(),
      p_student_id: studentId.trim(),
      p_phone: (values['phone'] ?? '').trim() || null,
      p_department: (values['department'] ?? '').trim() || null,
      p_year_of_study: (values['year_of_study'] ?? '').trim() || null,
      p_fields: values,
    })
    if (err) {
      setBusy(false)
      setError(errorMessage(err))
      return
    }
    const info = (data ?? {}) as { application_id?: string | null; to_email?: string; full_name?: string; duplicate?: boolean; reason?: string; stage?: string }
    if (!info.application_id) {
      setBusy(false)
      if (info.reason === 'closed') {
        setClosedOpen(true)
        return
      }
      if (info.reason === 'in-review') {
        setError(
          info.stage === 'final'
            ? 'You already have an application in Final Selection — the team will get back to you.'
            : `You already have an application under review in the ${info.stage === 'interview' ? 'Interview' : 'GD'} round — we will get back to you.`
        )
      } else if (info.reason === 'member') {
        setError('This email is already registered. Please log in instead.')
      } else {
        setError('Could not create your application. Please try again.')
      }
      return
    }

    if (!settings.signup_email_otp) {
      setBusy(false)
      setSubmitted({ fullName: info.full_name ?? fullName.trim(), batch: null })
      return
    }

    const nav = () =>
      navigate('/verify-application', {
        state: {
          id: info.application_id,
          email: info.to_email ?? email.trim(),
          fullName: info.full_name ?? fullName.trim(),
        },
      })

    // If a code was recently emailed to this address, don't send another — the
    // verify page shows the remaining wait instead.
    const { data: throttle } = await supabase.rpc('email_send_status', { p_email: email.trim() })
    const waitSeconds = Number((throttle as { wait_seconds?: number } | null)?.wait_seconds ?? 0)
    const locked = (throttle as { locked?: boolean } | null)?.locked === true
    if (locked) {
      setBusy(false)
      setError('Too many verification attempts for this email. Please try again after 10 hours.')
      return
    }
    if (waitSeconds > 0) {
      setBusy(false)
      nav()
      return
    }

    const { error: mailErr } = await supabase.functions.invoke('send-recruit-email', {
      body: { kind: 'join-verification', application_id: info.application_id },
    })
    setBusy(false)
    if (mailErr) {
      const msg = `We couldn't email the verification code. ${await emailInvokeMessage(mailErr)}`
      setError(msg)
      alert(msg)
      return
    }
    nav()
  }

  if (deadlinePassed) {
    return (
      <>
        <div className="card p-8">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-6 text-center">
            <CircleSlash size={36} className="mx-auto mb-3 text-amber-500" />
            <h1 className="text-lg font-extrabold text-amber-900">Registrations are closed</h1>
            <p className="mt-1 text-sm font-medium text-amber-700">The Join CIIE application deadline has passed.</p>
          </div>
          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-primary-600 hover:underline">
              Log in
            </Link>
          </p>
        </div>
        <RegistrationsClosed onClose={() => navigate('/')} />
      </>
    )
  }

  if (!settings.allow_public_signup) {
    return (
      <div className="card p-8">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-6 text-center">
          <CircleSlash size={36} className="mx-auto mb-3 text-amber-500" />
          <h1 className="text-lg font-extrabold text-amber-900">CIIE is not recruiting now</h1>
          <p className="mt-1 text-sm font-medium text-amber-700">CIIE recruitment is currently closed.</p>
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-primary-600 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-r from-primary-600 to-primary-800 px-8 py-10 text-center text-white">
          <CalendarCheck size={40} className="mx-auto mb-3" />
          <h1 className="text-2xl font-extrabold">Application received!</h1>
          <p className="mt-1 text-sm text-primary-100">
            Welcome to CIIE, {submitted.fullName}. Your application is being reviewed.
          </p>
        </div>
        <div className="px-8 py-8 text-center">
          <p className="text-sm text-slate-500">
            We've received your application. The CIIE team will review it and get back to you with your GD &amp;
            interview details.
          </p>
          <Link to="/" className="btn-secondary mt-6 inline-block">
            Back to home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="card p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-600">
          <UserPlus size={24} />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Join CIIE</h1>
        <p className="mt-1 text-sm text-slate-500">
          Apply to become a CIIE member. After the GD &amp; interview round, your application is reviewed by the team.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name">
          <TextInput required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Rahul Kumar" />
        </Field>
        <Field label="Student ID (university roll number)">
          <TextInput required inputMode="numeric" value={studentId} onChange={(e) => setStudentId(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="e.g. 2300123456" />
        </Field>
        <Field label="Email" hint={settings.signup_domain_restriction ? (settings.signup_email_otp ? 'A valid student email is mandatory. We send a verification code to this address.' : 'A valid student email is mandatory.') : undefined}>
          <TextInput type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={settings.signup_domain_restriction ? 'you@kluniversity.in' : 'you@example.com'} />
        </Field>

        {fields.length > 0 && (
          <div className="border-t border-slate-100 pt-4">
            <h3 className="mb-3 text-sm font-bold text-slate-900">Your details</h3>
            <CustomFieldInputs fields={fields} values={values} onChange={setValues} />
          </div>
        )}

        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-xs text-primary-800">
          <p className="flex items-center gap-2 font-semibold">
            <MailCheck size={15} className="shrink-0" /> No account is created.
          </p>
          <p className="mt-1 text-primary-700/80">
            {settings.signup_email_otp
              ? "We only email a verification code to confirm your application. You'll create an account if you're selected as a CIIE member."
              : "Your application will be submitted directly. You'll create an account if you're selected as a CIIE member."}
          </p>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Submit application'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Already a member?{' '}
        <Link to="/login" className="font-semibold text-primary-600 hover:underline">
          Log in
        </Link>
      </p>
      <p className="mt-2 text-center text-xs text-slate-400">
        Have a registration key for a specific role?{' '}
        <Link to="/register" className="font-semibold text-primary-600 hover:underline">
          Register with a key
        </Link>
      </p>
    </div>
      {closedOpen && (
        <RegistrationsClosed
          onClose={() => {
            setClosedOpen(false)
            navigate('/')
          }}
        />
      )}
    </>
  )
}
