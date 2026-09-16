import { useState } from 'react'
import { ImageUp } from 'lucide-react'
import { Avatar, Button, Field, SelectInput, TextInput } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { ROLE_LABELS } from '@/lib/types'
import { errorMessage, isValidTenDigit } from '@/lib/utils'

const emptyForm = {
  full_name: '',
  email: '',
  role: 'member',
  student_id: '',
  department: '',
  year_of_study: '',
  team: '',
  domain: '',
  telegram: '',
  github: '',
  linkedin: '',
  contact_email: '',
}

interface MemberAddFormProps {
  onCreated: () => void | Promise<void>
  submitLabel?: string
}

export default function MemberAddForm({ onCreated, submitLabel = 'Add member' }: MemberAddFormProps) {
  const [form, setForm] = useState(emptyForm)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

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
    if (!form.full_name.trim()) {
      setError('Name is required.')
      return
    }
    if (!isValidTenDigit(form.student_id)) {
      setError('Student ID is required and must be exactly 10 digits.')
      return
    }
    setBusy(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('admin_list_member', {
      p_full_name: form.full_name.trim(),
      p_email: form.email.trim() || null,
      p_role: form.role,
      p_student_id: form.student_id.trim() || null,
      p_department: form.department.trim() || null,
      p_year_of_study: form.year_of_study.trim() || null,
      p_team: form.team.trim() || null,
      p_domain: form.domain.trim() || null,
      p_avatar_url: avatarUrl || null,
      p_telegram: form.telegram.trim() || null,
      p_github: form.github.trim() || null,
      p_linkedin: form.linkedin.trim() || null,
      p_contact_email: form.contact_email.trim() || null,
    })
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
    await onCreated()
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <Avatar name={form.full_name || 'New'} src={avatarUrl || null} className="h-14 w-14 text-lg" />
        <div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
            <ImageUp size={15} /> {uploading ? 'Uploading…' : 'Upload photo'}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => void uploadAvatar(e.target.files?.[0])} />
          </label>
          <p className="mt-1 text-xs text-slate-400">Shown in the CIIE Members directory.</p>
        </div>
      </div>
      <Field label="Photo URL" hint="Optional — paste an image link instead of uploading">
        <TextInput value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value.trim())} placeholder="https://example.com/photo.jpg" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name">
          <TextInput value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Name Surname" />
        </Field>
        <Field label="Email" hint="Optional — used to link an existing login if they have one">
          <TextInput value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@email.com" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Role">
          <SelectInput value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.entries(ROLE_LABELS)
              .filter(([k]) => k !== 'user')
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </SelectInput>
        </Field>
        <Field label="Student Id *" hint="Exactly 10 digits">
          <TextInput required maxLength={10} value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="e.g. 2300123456" inputMode="numeric" />
        </Field>
        <Field label="Department">
          <TextInput value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="CSE" />
        </Field>
        <Field label="Year of study">
          <TextInput value={form.year_of_study} onChange={(e) => setForm({ ...form, year_of_study: e.target.value })} placeholder="2nd Year" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Position">
          <TextInput value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="President, Lead, Coordinator…" />
        </Field>
        <Field label="Domain">
          <TextInput value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="Web Development" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Telegram">
          <TextInput value={form.telegram} onChange={(e) => setForm({ ...form, telegram: e.target.value })} placeholder="@username" />
        </Field>
        <Field label="GitHub">
          <TextInput value={form.github} onChange={(e) => setForm({ ...form, github: e.target.value })} placeholder="username" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="LinkedIn">
          <TextInput value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="https://linkedin.com/in/…" />
        </Field>
        <Field label="Public email">
          <TextInput value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} placeholder="public@email.com" />
        </Field>
      </div>

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={busy || uploading}>
          {busy ? 'Adding…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
