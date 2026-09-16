import { useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BadgeCheck, UserRoundCheck } from 'lucide-react'
import { Button, Field, PageLoader, Spinner, TextInput } from '@/components/ui'
import { CustomFieldInputs } from '@/components/RegistrationFormFields'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { missingCompletionFields } from '@/lib/profileCompletion'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/utils'
import PhoneInput from '@/components/PhoneInput'

export default function CompleteProfile() {
  const { profile, loading, refreshProfile } = useAuth()
  const settings = useSettings()
  const navigate = useNavigate()
  const location = useLocation()

  const [values, setValues] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {}
    if (profile?.full_name) start.full_name = profile.full_name
    if (profile?.phone) start.phone = profile.phone
    if (profile?.department) start.department = profile.department
    for (const [k, v] of Object.entries(profile?.custom_fields ?? {})) start[k] = String(v ?? '')
    return start
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const missing = useMemo(
    () => missingCompletionFields(profile, settings.register_fields),
    [profile, settings.register_fields],
  )

  if (loading) return <PageLoader />

  const next = (location.state as { from?: string } | null)?.from ?? '/dashboard'

  const missingBase = missing.filter((f) => ['full_name', 'student_id', 'phone', 'department'].includes(f.key))
  const missingExtras = missing.filter((f) => !['full_name', 'student_id', 'phone', 'department'].includes(f.key))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const studentId = String(values['student_id'] ?? '').trim()
    const phone = String(values['phone'] ?? '').trim()
    const department = String(values['department'] ?? '').trim()
    const fullName = String(values['full_name'] ?? (profile?.full_name ?? '')).trim()

    if (!fullName) {
      setError('Please enter your full name.')
      return
    }
    if (missing.some((f) => f.key === 'student_id')) {
      if (!/^\d{10}$/.test(studentId)) {
        setError('Student ID is required and must be exactly 10 digits.')
        return
      }
    }
    if (missing.some((f) => f.key === 'phone')) {
      if (phone.replace(/[^0-9]/g, '').length < 10) {
        setError('A valid phone number is required.')
        return
      }
    }
    if (missing.some((f) => f.key === 'department') && !department) {
      setError('Department / Branch is required.')
      return
    }
    for (const f of missingExtras) {
      if (!String(values[f.key] ?? '').trim()) {
        setError(`"${f.label}" is required.`)
        return
      }
    }

    setBusy(true)
    try {
      const { error: rpcErr } = await supabase.rpc('complete_my_profile', {
        p_student_id: studentId,
        p_phone: phone,
        p_department: department,
        p_custom_fields: Object.fromEntries(
          missingExtras.map((f) => [f.key, String(values[f.key] ?? '').trim()]),
        ),
      })
      if (rpcErr) throw rpcErr
      await refreshProfile()
      setSaved(true)
      navigate(next, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (saved || missing.length === 0) {
    return (
      <div className="container-page max-w-2xl py-12">
        <div className="card p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100 text-green-600">
            <BadgeCheck size={28} />
          </div>
          <h1 className="text-xl font-bold text-slate-900">You're all set</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Your profile is complete. You can now use the dashboard and register for events.
          </p>
          <Button className="mt-6" onClick={() => navigate(next, { replace: true })}>
            Go to my dashboard
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container-page max-w-2xl py-12">
      <div className="card p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-600">
            <UserRoundCheck size={24} />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Complete your profile</h1>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Because you signed in with Microsoft, add the details below before you can use the dashboard or register for
            events. Everything is mandatory.
          </p>
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {missing.some((f) => f.key === 'full_name') && (
              <Field label="Full name *">
                <TextInput
                  required
                  value={values['full_name'] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, full_name: e.target.value }))}
                  placeholder="Rahul Kumar"
                />
              </Field>
            )}
            {missing.some((f) => f.key === 'student_id') && (
              <Field label="Student ID *" hint="Exactly 10 digits">
                <TextInput
                  required
                  inputMode="numeric"
                  maxLength={10}
                  value={values['student_id'] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, student_id: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                  placeholder="e.g. 2300123456"
                />
              </Field>
            )}
            {missing.some((f) => f.key === 'phone') && (
              <div className="sm:col-span-2">
                <Field label="Phone number *" hint="10-digit mobile number">
                  <PhoneInput value={values['phone'] ?? ''} onChange={(v) => setValues((p) => ({ ...p, phone: v }))} />
                </Field>
              </div>
            )}
            {missing.some((f) => f.key === 'department') && (
              <Field label="Department / Branch *">
                <TextInput
                  required
                  value={values['department'] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, department: e.target.value }))}
                  placeholder="Department / Branch"
                />
              </Field>
            )}
          </div>

          {missingExtras.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="mb-3 text-sm font-bold text-slate-900">Additional details</h3>
              <CustomFieldInputs fields={missingExtras} values={values} onChange={setValues} />
            </div>
          )}

          {missingBase.length === 0 && missingExtras.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
              No missing details found — click below to continue.
            </p>
          )}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Save & continue'}
          </Button>
        </form>
      </div>
    </div>
  )
}