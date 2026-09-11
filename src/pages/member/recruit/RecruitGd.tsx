import { useMemo, useState } from 'react'
import { ClipboardList, Search, Send, UserPlus } from 'lucide-react'
import { Button, EmptyState, Modal, PageHeader, Spinner, TextArea, TextInput } from '@/components/ui'
import { CustomFieldInputs, missingFields } from '@/components/RegistrationFormFields'
import { useRecruitLive } from '@/hooks/useRecruitLive'
import { supabase } from '@/lib/supabase'
import type { RecruitApplicationRow, RecruitFormTemplate } from '@/lib/types'
import { errorMessage } from '@/lib/utils'
import { ApplicantInfo, StageBadge } from './RecruitBits'

export default function RecruitGd() {
  const { rows, error: liveError, refresh } = useRecruitLive()

  const [active, setActive] = useState<RecruitApplicationRow | null>(null)
  const [template, setTemplate] = useState<RecruitFormTemplate | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const gdRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? [])
      .filter((r) => r.stage === 'gd')
      .filter(
        (r) =>
          !q ||
          [r.full_name, r.email, r.ciie_id, r.student_id].some((v) => v?.toLowerCase().includes(q)),
      )
  }, [rows, query])

  const open = async (row: RecruitApplicationRow) => {
    setActive(row)
    setValues({})
    setRemarks('')
    setError('')
    const { data } = await supabase
      .from('recruit_form_templates')
      .select('*')
      .eq('kind', 'gd')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setTemplate((data as RecruitFormTemplate | null) ?? null)
  }

  const submit = async () => {
    if (!active) return
    const fields = template?.fields ?? []
    if (!template) {
      setError('The GD form has not been configured yet. Ask an admin to create it.')
      return
    }
    const missing = missingFields(fields, values)
    if (missing) {
      setError(missing)
      return
    }
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc('submit_recruit_evaluation', {
      p_application_id: active.application_id,
      p_kind: 'gd',
      p_responses: values,
      p_remarks: remarks.trim() || null,
    })
    setBusy(false)
    if (err) {
      setError(errorMessage(err))
      return
    }
    void refresh()
    setActive(null)
  }

  return (
    <div>
      <PageHeader
        title="GD Round"
        subtitle="Applications appear here live as students register. Fill the GD form to forward an applicant to the Interview round."
      />

      {liveError && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{liveError}</p>}

      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <TextInput
          className="!pl-9"
          type="search"
          placeholder="Search name / CIIE ID / email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {gdRows.length === 0 ? (
        <EmptyState
          icon={<UserPlus size={36} />}
          title="No applicants in the GD round"
          subtitle="New Join CIIE registrations show up here instantly."
        />
      ) : (
        <div className="card divide-y divide-slate-100">
          {gdRows.map((row) => (
            <div key={row.application_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <ApplicantInfo row={row} />
              <div className="flex items-center gap-3">
                <StageBadge stage={row.stage} />
                <Button className="!px-3 !py-1.5 text-xs" onClick={() => void open(row)}>
                  <ClipboardList size={14} /> Fill GD form
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!active} onClose={() => setActive(null)} title={`GD form — ${active?.full_name ?? ''}`} wide>
        {active && (
          <div className="space-y-4">
            <ApplicantInfo row={active} />

            {template ? (
              <>
                <div>
                  <p className="text-sm font-bold text-slate-900">{template.title}</p>
                  {template.description && <p className="text-xs text-slate-500">{template.description}</p>}
                </div>
                <CustomFieldInputs fields={template.fields} values={values} onChange={setValues} />
                <div>
                  <p className="label">Remarks</p>
                  <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Overall remarks about this applicant in the GD round…" />
                </div>
                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                <Button className="w-full" disabled={busy} onClick={() => void submit()}>
                  {busy ? <Spinner className="border-white/40 border-t-white" /> : (
                    <>
                      <Send size={16} /> Submit GD form &amp; forward to Interview
                    </>
                  )}
                </Button>
              </>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                The GD form has not been configured yet. Ask an admin to create it under Admin → Recruit Forms.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
