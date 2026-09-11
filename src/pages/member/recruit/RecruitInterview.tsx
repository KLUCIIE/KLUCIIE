import { useMemo, useState } from 'react'
import { ClipboardCheck, FastForward, Search, Send } from 'lucide-react'
import { Badge, Button, EmptyState, Modal, PageHeader, Spinner, TextArea, TextInput } from '@/components/ui'
import { CustomFieldInputs, missingFields } from '@/components/RegistrationFormFields'
import { useRecruitLive } from '@/hooks/useRecruitLive'
import { supabase } from '@/lib/supabase'
import type { RecruitApplicationRow, RecruitFormTemplate } from '@/lib/types'
import { errorMessage } from '@/lib/utils'
import { ApplicantInfo, ResponsesView, StageBadge } from './RecruitBits'

export default function RecruitInterview() {
  const { rows, error: liveError, refresh } = useRecruitLive()

  const [active, setActive] = useState<RecruitApplicationRow | null>(null)
  const [template, setTemplate] = useState<RecruitFormTemplate | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  // Applicants stay in this list after an opinion is submitted (and even
  // after being forwarded) so every panelist can add their own opinion.
  const interviewRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? [])
      .filter((r) => r.stage === 'interview' || r.stage === 'final')
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
      .eq('kind', 'interview')
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
      setError('The Interview form has not been configured yet. Ask an admin to create it.')
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
      p_kind: 'interview',
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

  const forward = async (row: RecruitApplicationRow) => {
    if (
      !window.confirm(
        `Forward ${row.full_name ?? 'this applicant'} to Final Selection? Other panelists can still add their interview opinions afterwards.`,
      )
    )
      return
    setError('')
    const { error: err } = await supabase.rpc('forward_recruit_to_final', {
      p_application_id: row.application_id,
    })
    if (err) setError(errorMessage(err))
    else void refresh()
  }

  const opinionCount = (row: RecruitApplicationRow) => (row.interview_evaluations ?? []).length

  return (
    <div>
      <PageHeader
        title="Interview Round"
        subtitle="Submit your interview opinion — the applicant stays in the list so other panelists can add theirs too. Use Forward to send them to Final Selection."
      />

      {liveError && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{liveError}</p>}
      {error && !active && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

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

      {interviewRows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={36} />}
          title="No applicants in the Interview round"
          subtitle="Applicants are forwarded here automatically once their GD form is submitted."
        />
      ) : (
        <div className="card divide-y divide-slate-100">
          {interviewRows.map((row) => (
            <div key={row.application_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <ApplicantInfo row={row} />
              <div className="flex flex-wrap items-center gap-2">
                <StageBadge stage={row.stage} />
                <Badge tone="slate">
                  {opinionCount(row)} {opinionCount(row) === 1 ? 'opinion' : 'opinions'}
                </Badge>
                {row.stage === 'interview' && (
                  <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => void forward(row)}>
                    <FastForward size={14} /> Forward to Final
                  </Button>
                )}
                <Button className="!px-3 !py-1.5 text-xs" onClick={() => void open(row)}>
                  <ClipboardCheck size={14} /> Open interview form
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!active} onClose={() => setActive(null)} title={`Interview form — ${active?.full_name ?? ''}`} wide>
        {active && (
          <div className="space-y-4">
            <ApplicantInfo row={active} />

            <ResponsesView
              title="GD round"
              evaluator={active.gd_evaluator}
              fields={active.gd_form_fields}
              responses={active.gd_responses}
              remarks={active.gd_remarks}
            />

            {(active.interview_evaluations ?? []).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Interview opinions so far ({(active.interview_evaluations ?? []).length})
                </p>
                {(active.interview_evaluations ?? []).map((ev, i) => (
                  <ResponsesView
                    key={ev.evaluator_id ?? i}
                    title={`Opinion ${i + 1}`}
                    evaluator={ev.evaluator_name}
                    ciieId={ev.evaluator_ciie_id}
                    submittedAt={ev.submitted_at}
                    fields={active.interview_form_fields}
                    responses={ev.responses}
                    remarks={ev.remarks}
                  />
                ))}
              </div>
            )}

            {template ? (
              <>
                <div>
                  <p className="text-sm font-bold text-slate-900">{template.title}</p>
                  {template.description && <p className="text-xs text-slate-500">{template.description}</p>}
                </div>
                <CustomFieldInputs fields={template.fields} values={values} onChange={setValues} />
                <div>
                  <p className="label">Remarks</p>
                  <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Overall remarks about this applicant in the Interview round…" />
                </div>
                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                <Button className="w-full" disabled={busy} onClick={() => void submit()}>
                  {busy ? <Spinner className="border-white/40 border-t-white" /> : (
                    <>
                      <Send size={16} /> Submit my Interview opinion
                    </>
                  )}
                </Button>
                <p className="text-center text-xs text-slate-400">
                  The applicant stays in the Interview round — forwarding to Final Selection is a separate step.
                </p>
              </>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                The Interview form has not been configured yet. Ask an admin to create it under Admin → Recruit Forms.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
