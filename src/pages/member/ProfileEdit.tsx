import { useEffect, useState, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { Avatar, Button, Field, SelectInput, TextArea, TextInput, Toggle } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { PrivacySettings } from '@/lib/types'
import { errorMessage, isValidTenDigit, normalizePhone } from '@/lib/utils'

export default function ProfileEdit() {
  const { profile, refreshProfile } = useAuth()
  const [retrying, setRetrying] = useState(false)
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    department: '',
    year_of_study: '',
    academic_year: '',
    team: '',
    domain: '',
    bio: '',
    skills: '',
    linkedin: '',
    github: '',
    portfolio: '',
    twitter: '',
    telegram: '',
    contact_email: '',
  })
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!profile) return
    let active = true
    supabase
      .from('member_privacy_settings')
      .select('*')
      .eq('member_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) {
          setPrivacy((data as PrivacySettings) ?? null)
        }
      })
    setForm({
      full_name: profile.full_name ?? '',
      phone: normalizePhone(profile.phone ?? ''),
      department: profile.department ?? '',
      year_of_study: profile.year_of_study ?? '',
      academic_year: profile.academic_year ?? '',
      team: profile.team ?? '',
      domain: profile.domain ?? '',
      bio: profile.bio ?? '',
      skills: (profile.skills ?? []).join(', '),
      linkedin: profile.social_links?.linkedin ?? '',
      github: profile.social_links?.github ?? '',
      portfolio: profile.social_links?.portfolio ?? '',
      twitter: profile.social_links?.twitter ?? '',
      telegram: profile.social_links?.telegram ?? '',
      contact_email: profile.social_links?.email ?? '',
    })
    setAvatarUrl(profile.avatar_url ?? '')
    return () => {
      active = false
    }
  }, [profile])

  if (!profile) {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-lg font-bold text-slate-900">Profile not found</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your account isn't linked to a member profile yet. Please contact the CIIE administrator.
        </p>
        <Button
          variant="secondary"
          className="mt-4"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true)
            await refreshProfile()
            setRetrying(false)
          }}
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      </div>
    )
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!isValidTenDigit(form.phone)) {
      setError('Phone number is required and must be exactly 10 digits.')
      return
    }
    setBusy(true)
    setNotice('')
    const skills = form.skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const { error: err } = await supabase
      .from('profiles')
      .update({
        full_name: form.full_name,
        phone: normalizePhone(form.phone),
        department: form.department || null,
        year_of_study: form.year_of_study || null,
        academic_year: form.academic_year || null,
        team: form.team || null,
        domain: form.domain || null,
        bio: form.bio || null,
        skills,
        avatar_url: avatarUrl.trim() || null,
        social_links: {
          linkedin: form.linkedin,
          github: form.github,
          portfolio: form.portfolio,
          twitter: form.twitter,
          telegram: form.telegram,
          email: form.contact_email,
        },
      })
      .eq('id', profile.id)

    if (err) {
      setError(errorMessage(err))
      setBusy(false)
      return
    }

    if (privacy) {
      await supabase.from('member_privacy_settings').upsert({
        member_id: profile.id,
        show_on_leaderboard: privacy.show_on_leaderboard,
        show_public_profile: privacy.show_public_profile,
        show_points: privacy.show_points,
        show_events: privacy.show_events,
        show_contact: privacy.show_contact,
        show_avatar: privacy.show_avatar,
      })
    }

    await refreshProfile()
    setBusy(false)
    setNotice('Profile saved.')
  }

  const toggle = (key: keyof PrivacySettings) => {
    if (privacy) setPrivacy({ ...privacy, [key]: !privacy[key] })
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-extrabold text-slate-900">Edit Profile</h1>
      <p className="mt-1 text-sm text-slate-500">CIIE ID {profile.ciie_id} • {profile.role.replace('_', ' ')}</p>

      <form onSubmit={save} className="mt-6 space-y-6">
        <section className="card space-y-4 p-6">
          <h2 className="text-base font-bold text-slate-900">Profile photo</h2>
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={profile.full_name} src={avatarUrl || null} className="h-20 w-20 text-2xl" />
            <div className="min-w-[260px] flex-1">
              <Field label="Photo URL" hint="Paste an image link — shown in the CIIE members directory and your public profile.">
                <TextInput value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value.trim())} placeholder="https://example.com/photo.jpg" />
              </Field>
            </div>
          </div>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="text-base font-bold text-slate-900">About</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <TextInput value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </Field>
            <Field label="Phone *" hint="Exactly 10 digits">
              <TextInput required inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="e.g. 9876543210" />
            </Field>
            <Field label="Department">
              <TextInput value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="CSE" />
            </Field>
            <Field label="Year of study">
              <SelectInput value={form.year_of_study} onChange={(e) => setForm({ ...form, year_of_study: e.target.value })}>
                <option value="">Select</option>
                {['1st Year', '2nd Year', '3rd Year', '4th Year'].map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Academic year">
              <TextInput value={form.academic_year} onChange={(e) => setForm({ ...form, academic_year: e.target.value })} placeholder="2026-27" />
            </Field>
            {profile.role !== 'user' && (
              <>
                <Field label="Position">
                  <TextInput value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="President, Lead, Coordinator…" />
                </Field>
                <Field label="Domain" hint="Your designation, e.g. Web Development, Design, Marketing">
                  <TextInput value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="Web Development" />
                </Field>
              </>
            )}
          </div>
          <Field label="Bio">
            <TextArea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="A short introduction…" />
          </Field>
          <Field label="Skills" hint="Comma separated, e.g. Python, UI Design, Public Speaking">
            <TextInput value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} />
          </Field>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="text-base font-bold text-slate-900">Social Links</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="LinkedIn">
              <TextInput value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="https://linkedin.com/in/…" />
            </Field>
            <Field label="GitHub">
              <TextInput value={form.github} onChange={(e) => setForm({ ...form, github: e.target.value })} placeholder="https://github.com/…" />
            </Field>
            <Field label="Portfolio">
              <TextInput value={form.portfolio} onChange={(e) => setForm({ ...form, portfolio: e.target.value })} placeholder="https://…" />
            </Field>
            <Field label="Twitter / X">
              <TextInput value={form.twitter} onChange={(e) => setForm({ ...form, twitter: e.target.value })} placeholder="https://x.com/…" />
            </Field>
            <Field label="Telegram">
              <TextInput value={form.telegram} onChange={(e) => setForm({ ...form, telegram: e.target.value })} placeholder="@username or https://t.me/…" />
            </Field>
            <Field label="Public contact email">
              <TextInput value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} placeholder="you@example.com" />
            </Field>
          </div>
        </section>

        {privacy && (
          <section className="card space-y-4 p-6">
            <h2 className="text-base font-bold text-slate-900">Privacy</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Toggle checked={privacy.show_on_leaderboard} onChange={() => toggle('show_on_leaderboard')} label="Show me on CIIE Leaderboard" />
              <Toggle checked={privacy.show_public_profile} onChange={() => toggle('show_public_profile')} label="Show public profile" />
              <Toggle checked={privacy.show_points} onChange={() => toggle('show_points')} label="Show my points publicly" />
              <Toggle checked={privacy.show_events} onChange={() => toggle('show_events')} label="Show my events publicly" />
              <Toggle checked={privacy.show_contact} onChange={() => toggle('show_contact')} label="Show my contact info" />
              <Toggle checked={privacy.show_avatar} onChange={() => toggle('show_avatar')} label="Show my photo" />
            </div>
          </section>
        )}

        {notice && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <Button type="submit" disabled={busy}>
          <Save size={16} /> Save profile
        </Button>
      </form>
    </div>
  )
}
