import { useState } from 'react'
import { ImageUp } from 'lucide-react'
import { Avatar, Button, Field, SelectInput, TextArea, TextInput } from '@/components/ui'
import { useSettings } from '@/hooks/useSettings'
import { supabase } from '@/lib/supabase'
import type { AmtpsMember } from '@/lib/types'
import { errorMessage, isValidTenDigit } from '@/lib/utils'

const emptyForm = {
  full_name: '',
  email: '',
  student_id: '',
  department: '',
  year_of_study: '',
  position: '',
  domain: '',
  about: '',
  telegram: '',
  github: '',
  linkedin: '',
  contact_email: '',
  wing: '',
}

function toForm(m: AmtpsMember | null) {
  if (!m) return emptyForm
  return {
    full_name: m.full_name ?? '',
    email: m.email ?? '',
    student_id: m.student_id ?? '',
    department: m.department ?? '',
    year_of_study: m.year_of_study ?? '',
    position: m.position ?? '',
    domain: m.domain ?? '',
    about: m.about ?? '',
    telegram: m.telegram ?? '',
    github: m.github ?? '',
    linkedin: m.linkedin ?? '',
    contact_email: m.contact_email ?? '',
    wing: m.wing ?? '',
  }
}

interface AmtpsMemberFormProps {
  initial?: AmtpsMember | null
  onSaved: () => void | Promise<void>
  submitLabel?: string
}

export default function AmtpsMemberForm({ initial, onSaved, submitLabel = 'Add member' }: AmtpsMemberFormProps) {
  const [form, setForm] = useState(toForm(initial ?? null))
  const [avatarUrl, setAvatarUrl] = useState(initial?.avatar_url ?? '')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const settings = useSettings()
  const wings = settings.amtps_wings ?? []

  const set = (key: keyof typeof emptyForm, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError('')
    const path = `pending-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/\.{2,}/g, '.')}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    setUploading(false)
    if (upErr) {
      setError(errorMessage(upErr))
      return
    }
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    setAvatarUrl(pub.publicUrl)
  }

  const submit = async () => {
    setError('')
    if (!form.full_name.trim()) {
      setError('Name is required.')
      return
    }
    if (!isValidTenDigit(form.student_id)) {
      setError('Student ID is required and must be exactly 10 digits.')
      return
    }
    setBusy(true)
    const params = {
      p_full_name: form.full_name.trim() || null,
      p_email: form.email.trim() || null,
      p_student_id: form.student_id.trim() || null,
      p_department: form.department.trim() || null,
      p_year_of_study: form.year_of_study.trim() || null,
      p_position: form.position.trim() || null,
      p_domain: form.domain.trim() || null,
      p_about: form.about.trim() || null,
      p_avatar_url: avatarUrl.trim() || null,
      p_telegram: form.telegram.trim() || null,
      p_github: form.github.trim() || null,
      p_linkedin: form.linkedin.trim() || null,
      p_contact_email: form.contact_email.trim() || null,
      p_wing: form.wing.trim() || null,
    }
    const { data, error: rpcError } = initial
      ? await supabase.rpc('admin_update_amtps_member', { p_id: initial.id, ...params })
      : await supabase.rpc('admin_add_amtps_member', params)
    setBusy(false)
    if (rpcError) {
      setError(errorMessage(rpcError))
      return
    }
    const res = (data ?? {}) as { ok?: boolean; error?: string }
    if (res.error) {
      setError(res.error)
      return
    }
    setForm(emptyForm)
    setAvatarUrl('')
    await onSaved()
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <Avatar name={form.full_name || 'AMTPS'} src={avatarUrl || null} className="h-14 w-14 text-lg" />
        <div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
            <ImageUp size={15} /> {uploading ? 'Uploading…' : 'Upload photo'}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => void uploadAvatar(e.target.files?.[0])} />
          </label>
          <p className="mt-1 text-xs text-slate-400">Shown on the AMTPS square card.</p>
        </div>
      </div>
      <Field label="Photo URL" hint="Optional — paste an image link instead of uploading">
        <TextInput value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value.trim())} placeholder="https://example.com/photo.jpg" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name">
          <TextInput value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="Name Surname" />
        </Field>
        <Field label="Email">
          <TextInput value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="name@email.com" />
        </Field>
        <Field label="Student Id *" hint="Exactly 10 digits">
          <TextInput required maxLength={10} inputMode="numeric" value={form.student_id} onChange={(e) => set('student_id', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="e.g. 2300123456" />
        </Field>
        <Field label="Department">
          <TextInput value={form.department} onChange={(e) => set('department', e.target.value)} placeholder="CSE" />
        </Field>
        <Field label="Year of study">
          <TextInput value={form.year_of_study} onChange={(e) => set('year_of_study', e.target.value)} placeholder="2nd Year" />
        </Field>
        <Field label="Position">
          <TextInput value={form.position} onChange={(e) => set('position', e.target.value)} placeholder="President, Lead, Coordinator…" />
        </Field>
        <Field label="Domain">
          <TextInput value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="Web Development" />
        </Field>
        {wings.length > 0 && (
          <Field label="Wing">
            <SelectInput value={form.wing} onChange={(e) => set('wing', e.target.value)}>
              <option value="">— No wing —</option>
              {wings.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </SelectInput>
          </Field>
        )}
      </div>
      <Field label="About">
        <TextArea
          rows={3}
          value={form.about}
          onChange={(e) => set('about', e.target.value)}
          placeholder="A short bio — their role, interests and what they do at CIIE."
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Telegram">
          <TextInput value={form.telegram} onChange={(e) => set('telegram', e.target.value)} placeholder="@username" />
        </Field>
        <Field label="GitHub">
          <TextInput value={form.github} onChange={(e) => set('github', e.target.value)} placeholder="username" />
        </Field>
        <Field label="LinkedIn">
          <TextInput value={form.linkedin} onChange={(e) => set('linkedin', e.target.value)} placeholder="https://linkedin.com/in/…" />
        </Field>
        <Field label="Public email">
          <TextInput value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} placeholder="public@email.com" />
        </Field>
      </div>

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={busy || uploading}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
