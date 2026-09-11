import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Ticket } from 'lucide-react'
import { Button, Field, Modal, PageLoader, SelectInput, Spinner, TextInput, TextArea } from '@/components/ui'
import { CircleSlash } from 'lucide-react'
import PhoneInput, { parsePhone } from '@/components/PhoneInput'
import { useAuth } from '@/hooks/useAuth'
import { fetchEvent } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import type { Event, EventRegistration } from '@/lib/types'
import { errorMessage, isValidTenDigit, seatsRemaining } from '@/lib/utils'

interface FormField {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'textarea'
  required: boolean
  options?: string[]
}

export default function EventRegister() {
  const { id } = useParams<{ id: string }>()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [event, setEvent] = useState<Event | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [department, setDepartment] = useState('')
  const [college, setCollege] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!id) return
    fetchEvent(id).then((ev) => {
      setEvent(ev)
      setLoading(false)
      if (ev) {
        if (user && profile) {
          setName(profile.full_name ?? '')
          setStudentId(profile.student_id ?? '')
          setEmail(user.email ?? '')
        }
      }
    })
  }, [id, user, profile])

  if (loading) return <PageLoader />
  if (!event) {
    return (
      <div className="container-page py-20 text-center">
        <p className="text-lg font-semibold">Event not found</p>
        <Link to="/events" className="btn-primary mt-4">
          Browse events
        </Link>
      </div>
    )
  }

  const fields = (event.form_fields as unknown as FormField[]) ?? []

  const deadlinePassed =
    !!event.registration_deadline && new Date(event.registration_deadline).getTime() <= Date.now()
  if (deadlinePassed) {
    return (
      <div className="container-page max-w-2xl py-10">
        <div className="card p-8 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
            <CircleSlash size={26} />
          </span>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">Registrations are closed</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
            The registration deadline for this event has passed, so new registrations are no longer accepted.
          </p>
          <Link to="/events" className="btn-primary mt-6 inline-block">
            Browse events
          </Link>
        </div>
        <Modal open onClose={() => navigate('/events')} title="Registrations are closed">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
              <CircleSlash size={22} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Registration deadline has passed</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Registrations for <strong>{event.title}</strong> are closed — the registration deadline has passed.
              </p>
            </div>
          </div>
        </Modal>
      </div>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !department.trim() || !college.trim()) {
      setError('Please fill in all required fields.')
      setBusy(false)
      return
    }
    if (!isValidTenDigit(studentId)) {
      setError('Student ID is required and must be exactly 10 digits.')
      setBusy(false)
      return
    }
    if (!isValidTenDigit(parsePhone(phone).number)) {
      setError('Phone number is required and must be exactly 10 digits.')
      setBusy(false)
      return
    }
    setBusy(true)
    setError('')
    const formData: Record<string, unknown> = { ...answers }
    for (const f of fields) {
      if (f.required && !answers[f.key]) {
        setError(`"${f.label}" is required.`)
        setBusy(false)
        return
      }
      if (answers[f.key]) formData[f.key] = answers[f.key]
    }
    const { data, error: err } = await supabase.rpc('create_registration', {
      p_event_id: event.id,
      p_attendee_name: name.trim(),
      p_student_id: studentId.trim(),
      p_email: email.trim(),
      p_phone: phone.trim() || null,
      p_department: department.trim() || null,
      p_college: college.trim() || null,
      p_form_data: formData,
    })
    setBusy(false)
    if (err) {
      setError(errorMessage(err))
      return
    }
    if (data) {
      navigate(`/events/${event.slug ?? event.id}`, {
        state: {
          registrationSuccess: {
            registrationId: (data as EventRegistration).id,
            registration: data as EventRegistration,
          },
        },
      })
    }
  }

  return (
    <div className="container-page max-w-2xl py-10">
      <Link to={`/events/${event.slug ?? event.id}`} className="text-sm font-medium text-primary-600 hover:underline">
        ← Back to event
      </Link>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900 dark:text-slate-100">Register for {event.title}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {event.mode === 'offline' ? event.venue : 'Online event'} • {seatsRemaining(event)} seats remaining
      </p>

      <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name *">
            <TextInput required value={name} onChange={(e) => setName(e.target.value)} placeholder="Rahul Kumar" />
          </Field>
          <Field label="Student ID (university roll number) *" hint="Exactly 10 digits">
            <TextInput required maxLength={10} value={studentId} onChange={(e) => setStudentId(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="e.g. 2300123456" inputMode="numeric" />
          </Field>
          <Field label="Email *">
            <TextInput type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label="Phone *">
            <PhoneInput required value={phone} onChange={setPhone} />
          </Field>
          <Field label="Department *">
            <TextInput required value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="CSE" />
          </Field>
          <Field label="College / Institution *">
            <TextInput required value={college} onChange={(e) => setCollege(e.target.value)} placeholder="KL University" />
          </Field>
        </div>

        {fields.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-100">Additional questions</h3>
            <div className="grid gap-4">
              {fields.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}>
                  {f.type === 'textarea' ? (
                    <TextArea value={answers[f.key] ?? ''} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} rows={3} />
                  ) : f.type === 'select' ? (
                    <SelectInput value={answers[f.key] ?? ''} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}>
                      <option value="">Select…</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </SelectInput>
                  ) : (
                    <TextInput
                      type={f.type === 'number' ? 'number' : 'text'}
                      value={answers[f.key] ?? ''}
                      onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}
                    />
                  )}
                </Field>
              ))}
            </div>
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Spinner className="border-white/40 border-t-white" /> : <><Ticket size={16} /> Confirm registration</>}
        </Button>
      </form>
    </div>
  )
}
