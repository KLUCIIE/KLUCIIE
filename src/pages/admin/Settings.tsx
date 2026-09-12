import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react'
import { Button, Field, PageHeader, TextInput, Toggle } from '@/components/ui'
import { FieldListEditor } from '@/components/FieldListEditor'
import { useAuth } from '@/hooks/useAuth'
import { useRefreshSettings, useSettings } from '@/hooks/useSettings'
import { supabase } from '@/lib/supabase'
import type { AmtpsWing, CustomFieldDef, PlatformSettings } from '@/lib/types'
import { errorMessage } from '@/lib/utils'

const STORAGE_KEY = 'kl_ciie_admin_settings_draft'

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function emptyForm() {
  return {
    allow_public_signup: true,
    signup_domain_restriction: true,
    signup_email_otp: true,
    allow_password_reset: true,
    stop_dynamic_qr: false,
    use_attendance_realtime: true,
    signup_deadline: '',
    domains: 'kluniversity.in',
    interview_day_1: '',
    interview_day_2: '',
    facebook_url: '',
    instagram_url: '',
    linkedin_url: '',
    twitter_url: '',
    youtube_url: '',
    contact_email: '',
    contact_phone: '',
    office_address: '',
    register_fields: [] as CustomFieldDef[],
    signup_fields: [] as CustomFieldDef[],
    amtps_wings: [] as AmtpsWing[],
  }
}

type SettingsForm = ReturnType<typeof emptyForm>

function formFrom(current: PlatformSettings): SettingsForm {
  return {
    allow_public_signup: current.allow_public_signup,
    signup_domain_restriction: current.signup_domain_restriction,
    signup_email_otp: current.signup_email_otp,
    allow_password_reset: current.allow_password_reset,
    stop_dynamic_qr: current.stop_dynamic_qr,
    use_attendance_realtime: current.use_attendance_realtime,
    signup_deadline: current.signup_deadline ? toLocalInput(current.signup_deadline) : '',
    domains: (current.signup_allowed_domains ?? []).join(', '),
    interview_day_1: current.interview_day_1 ? String(current.interview_day_1).slice(0, 10) : '',
    interview_day_2: current.interview_day_2 ? String(current.interview_day_2).slice(0, 10) : '',
    facebook_url: current.facebook_url ?? '',
    instagram_url: current.instagram_url ?? '',
    linkedin_url: current.linkedin_url ?? '',
    twitter_url: current.twitter_url ?? '',
    youtube_url: current.youtube_url ?? '',
    contact_email: current.contact_email ?? '',
    contact_phone: current.contact_phone ?? '',
    office_address: current.office_address ?? '',
    register_fields: (current.register_fields ?? []) as CustomFieldDef[],
    signup_fields: (current.signup_fields ?? []) as CustomFieldDef[],
    amtps_wings: (current.amtps_wings ?? []) as AmtpsWing[],
  }
}

function readDraft(): SettingsForm | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return { ...emptyForm(), ...parsed }
  } catch {
    return null
  }
}

export default function Settings() {
  const { isSuperAdmin } = useAuth()
  const current = useSettings()
  const refresh = useRefreshSettings()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const savedDraft = useRef<SettingsForm | null>(readDraft())
  const [form, setForm] = useState<SettingsForm>(() => savedDraft.current ?? emptyForm())

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (savedDraft.current) return
    setForm(formFrom(current))
  }, [current])

  useEffect(() => {
    if (!savedDraft.current) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form))
    } catch {}
  }, [form])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!isSuperAdmin) return
    setBusy(true)
    setError('')
    setSaved(false)
    const payload = {
      allow_public_signup: form.allow_public_signup,
      signup_domain_restriction: form.signup_domain_restriction,
      signup_email_otp: form.signup_email_otp,
      allow_password_reset: form.allow_password_reset,
      stop_dynamic_qr: form.stop_dynamic_qr,
      use_attendance_realtime: form.use_attendance_realtime,
      signup_deadline: form.signup_deadline || null,
      signup_allowed_domains: form.domains
        .split(',')
        .map((d) => d.trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean),
      interview_day_1: form.interview_day_1 || null,
      interview_day_2: form.interview_day_2 || null,
      facebook_url: form.facebook_url.trim() || null,
      instagram_url: form.instagram_url.trim() || null,
      linkedin_url: form.linkedin_url.trim() || null,
      twitter_url: form.twitter_url.trim() || null,
      youtube_url: form.youtube_url.trim() || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      office_address: form.office_address.trim() || null,
      register_fields: form.register_fields,
      signup_fields: form.signup_fields,
      amtps_wings: form.amtps_wings,
    }
    const { error: upErr } = await supabase
      .from('platform_settings')
      .upsert({ id: 1, ...payload }, { onConflict: 'id' })
    setBusy(false)
    if (upErr) {
      setError(errorMessage(upErr))
      return
    }
    await supabase.rpc('log_admin_event', {
      p_action: 'Platform Settings Updated',
      p_entity_type: 'settings',
      p_entity_id: '1',
      p_details: payload,
    })
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {}
    savedDraft.current = null
    await refresh()
    setSaved(true)
  }

  if (!isSuperAdmin) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="Only a Super Admin can change platform settings." />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Recruitment and signup controls for the CIIE platform." />

      <form onSubmit={submit} className="max-w-3xl space-y-6">
        <section className="card space-y-4 p-6">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Registration</h2>
          <Toggle
            checked={form.allow_public_signup}
            onChange={(v) => setForm({ ...form, allow_public_signup: v })}
            label="Show Join CIIE button (allow public recruitment)"
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            When off, the Join CIIE button is hidden across the site and new recruitment signups are blocked. Event
            registration on individual event pages is unaffected.
          </p>
          <Toggle
            checked={form.signup_domain_restriction}
            onChange={(v) => setForm({ ...form, signup_domain_restriction: v })}
            label="Restrict signup to allowed email domains"
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            When on, only email addresses from the domains below can register. When off, every domain is allowed.
          </p>
          <Toggle
            checked={form.signup_email_otp}
            onChange={(v) => setForm({ ...form, signup_email_otp: v })}
            label="Require email OTP verification during registration"
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            When on, applicants must verify their email with a 6-digit code before their submission is accepted. When off,
            the OTP step is skipped — submissions are accepted immediately without email verification.
          </p>
          <Toggle
            checked={form.allow_password_reset}
            onChange={(v) => setForm({ ...form, allow_password_reset: v })}
            label="Allow users to reset their own password (Forgot password)"
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            When on, the “Forgot password?” link is shown on the login page and anyone can reset their password using the
            emailed code. When off, the link is hidden for everyone (including admins) and password resets via URL are
            blocked.
          </p>
          <Field label="Allowed email domains" hint="Comma separated — e.g. kluniversity.in">
            <TextInput value={form.domains} onChange={(e) => setForm({ ...form, domains: e.target.value })} />
          </Field>
          <Field
            label="Registration deadline"
            hint="Leave empty for no deadline. Once this date & time passes, all registration pages show a “Registrations are closed” popup and new applications are blocked."
          >
            <TextInput type="datetime-local" value={form.signup_deadline} onChange={(e) => setForm({ ...form, signup_deadline: e.target.value })} />
          </Field>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Attendance QR</h2>
          <Toggle
            checked={form.stop_dynamic_qr}
            onChange={(v) => setForm({ ...form, stop_dynamic_qr: v })}
            label="Stop dynamic QR (keep attendance QR static)"
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            When off (default), every member's attendance QR changes automatically every 60 seconds. When on, the QR
            does not change or refresh every 60 seconds — the same code stays valid until it is scanned.
          </p>
          <Toggle
            checked={form.use_attendance_realtime}
            onChange={(v) => setForm({ ...form, use_attendance_realtime: v })}
            label="Enable realtime for attendance"
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            When on (default), the member QR page receives push updates the moment their attendance is marked — the
            checkmark appears instantly. When off, the page polls every 5 seconds instead, which uses fewer realtime
            connections but adds a short delay.
          </p>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Join CIIE registration details</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            These fields appear on the Join CIIE (/signup) form. Every field is mandatory. Add any extra details you
            want to collect — phone, department, year of study, roll number, etc.
          </p>
          <FieldListEditor
            fields={form.signup_fields}
            hint="Leave empty to use the defaults (phone, year of study, department)."
            onChange={(signup_fields) => setForm({ ...form, signup_fields })}
          />
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Additional details for register</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Extra form fields collected under “Additional details” on every account registration page — /register/user,
            all role registrations and /register-faculty. NOT shown on the Join CIIE (/signup) form, which has its own
            section above. Answers are saved to each user's profile and visible in Admin → Members → member details and
            in the account-registrations export.
          </p>
          <FieldListEditor
            fields={form.register_fields}
            hint="Leave empty to collect only the standard details (phone, department, year of study)."
            onChange={(register_fields) => setForm({ ...form, register_fields })}
          />
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">GD &amp; Interview dates</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Applicants are split into two batches by registration order — batch 1 attends on the first date, batch 2 on the
            second. Every student sees their assigned date right after registering.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Batch 1 — GD & Interview date">
              <TextInput type="date" value={form.interview_day_1} onChange={(e) => setForm({ ...form, interview_day_1: e.target.value })} />
            </Field>
            <Field label="Batch 2 — GD & Interview date">
              <TextInput type="date" value={form.interview_day_2} onChange={(e) => setForm({ ...form, interview_day_2: e.target.value })} />
            </Field>
          </div>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">AMTPS Wings</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Define sub-groups for the AMTPS team showcase. Members are grouped by wing on the public /amtps page in the
            order listed below.
          </p>
          {form.amtps_wings.length === 0 && (
            <p className="text-xs text-slate-400 dark:text-slate-500">No wings defined yet. Add your first wing above.</p>
          )}
          <div className="space-y-2">
            {form.amtps_wings.map((wing, i) => (
              <div key={wing.id} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center text-xs font-bold text-slate-400 dark:text-slate-500">{i + 1}</span>
                <input
                  type="text"
                  value={wing.name}
                  onChange={(e) => {
                    const next = [...form.amtps_wings]
                    next[i] = { ...next[i], name: e.target.value }
                    setForm((f) => ({ ...f, amtps_wings: next }))
                  }}
                  className="input flex-1"
                  placeholder="Wing name"
                />
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-primary-600 disabled:opacity-30"
                  disabled={i === 0}
                  title="Move up"
                  onClick={() => {
                    const next = [...form.amtps_wings]
                    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                    setForm((f) => ({ ...f, amtps_wings: next }))
                  }}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-primary-600 disabled:opacity-30"
                  disabled={i === form.amtps_wings.length - 1}
                  title="Move down"
                  onClick={() => {
                    const next = [...form.amtps_wings]
                    ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
                    setForm((f) => ({ ...f, amtps_wings: next }))
                  }}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-red-50 hover:text-red-600"
                  title="Remove wing"
                  onClick={() => {
                    const next = form.amtps_wings.filter((_, j) => j !== i)
                    setForm((f) => ({ ...f, amtps_wings: next }))
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)
              setForm((f) => ({
                ...f,
                amtps_wings: [...f.amtps_wings, { id, name: '', display_order: f.amtps_wings.length }],
              }))
            }}
          >
            <Plus size={14} /> Add wing
          </Button>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Contact &amp; Social media</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Shown on the public About and Contact pages and in the site footer.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact email">
              <TextInput type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} placeholder="ciie@kluniversity.in" />
            </Field>
            <Field label="Contact phone">
              <TextInput type="tel" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} placeholder="+91 98765 43210" />
            </Field>
          </div>
          <Field label="Office address">
            <TextInput value={form.office_address} onChange={(e) => setForm({ ...form, office_address: e.target.value })} placeholder="CIIE Office, KL University Campus" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Facebook URL">
              <TextInput type="url" value={form.facebook_url} onChange={(e) => setForm({ ...form, facebook_url: e.target.value })} placeholder="https://facebook.com/..." />
            </Field>
            <Field label="Instagram URL">
              <TextInput type="url" value={form.instagram_url} onChange={(e) => setForm({ ...form, instagram_url: e.target.value })} placeholder="https://instagram.com/..." />
            </Field>
            <Field label="LinkedIn URL">
              <TextInput type="url" value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })} placeholder="https://linkedin.com/company/..." />
            </Field>
            <Field label="Twitter / X URL">
              <TextInput type="url" value={form.twitter_url} onChange={(e) => setForm({ ...form, twitter_url: e.target.value })} placeholder="https://x.com/..." />
            </Field>
            <div className="sm:col-span-2">
              <Field label="YouTube URL">
                <TextInput type="url" value={form.youtube_url} onChange={(e) => setForm({ ...form, youtube_url: e.target.value })} placeholder="https://youtube.com/@..." />
              </Field>
            </div>
          </div>
        </section>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {saved && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Settings saved.</p>}

        <Button type="submit" disabled={busy}>
          <Save size={16} /> Save settings
        </Button>
      </form>
    </div>
  )
}
