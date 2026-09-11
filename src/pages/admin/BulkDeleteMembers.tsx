import { useCallback, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'
import { Badge, Button, Modal, PageHeader } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { fetchAllProfiles } from '@/lib/queries'
import { downloadExcel } from '@/lib/excel'
import { cn, errorMessage } from '@/lib/utils'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CHUNK_SIZE = 50

type Phase = 'upload' | 'preview' | 'working' | 'done'

interface ParsedRow {
  index: number
  email: string
  found: boolean
  error: string | null
}

interface ResultRow {
  index: number
  email: string
  status: 'deleted' | 'failed' | 'not_found'
  error?: string
}

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z]/g, '')
}

function mapHeaders(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const h of headers) {
    const n = normHeader(String(h))
    if (!n) continue
    if (map.email === undefined && (n.includes('email') || n === 'mail' || n.includes('mailid'))) map.email = h
  }
  return map
}

export default function BulkDeleteMembers() {
  const [phase, setPhase] = useState<Phase>('upload')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmStep, setConfirmStep] = useState(0)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<ResultRow[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const validRows = useMemo(() => rows.filter((r) => !r.error), [rows])
  const invalidCount = rows.length - validRows.length
  const notFoundCount = rows.filter((r) => r.error === 'No account found with this email.').length

  const deletedCount = results.filter((r) => r.status === 'deleted').length
  const failedCount = results.filter((r) => r.status === 'failed').length
  const doneNotFoundCount = results.filter((r) => r.status === 'not_found').length

  const parseFile = useCallback(async (file: File) => {
    setParseError('')
    setFileName(file.name)
    try {
      const XLSX = await import('xlsx')
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const sheetName = wb.SheetNames[0]
      const sheet = sheetName ? wb.Sheets[sheetName] : null
      if (!sheet) throw new Error('The file has no sheets.')
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      if (raw.length === 0) throw new Error('No data rows found in the first sheet.')

      const headers = Object.keys(raw[0] ?? {})
      const col = mapHeaders(headers)
      if (!col.email) {
        throw new Error(
          `Could not find an Email column. Found columns: ${headers.join(', ')}. ` +
          'The file needs at least an Email column.',
        )
      }

      const emailsInFile = new Set<string>()

      const parsed: ParsedRow[] = raw.map((r, i) => {
        const email = String(r[col.email!] ?? '').trim().toLowerCase()
        let error: string | null = null
        if (!email) error = 'Email is empty.'
        else if (!EMAIL_RE.test(email)) error = 'Email is invalid.'
        else if (emailsInFile.has(email)) error = 'Duplicate email in this file.'
        emailsInFile.add(email)
        return { index: i + 1, email, found: false, error }
      })

      const existing = await fetchAllProfiles<{ email: string | null }>('email')
      const dbEmails = new Set(existing.map((p) => String(p.email ?? '').trim().toLowerCase()))
      for (const row of parsed) {
        if (row.error) continue
        if (!dbEmails.has(row.email)) {
          row.found = false
          row.error = 'No account found with this email.'
        } else {
          row.found = true
        }
      }

      setRows(parsed)
      setPhase('preview')
    } catch (err) {
      setParseError(errorMessage(err))
      setRows([])
    }
  }, [])

  const runDelete = async () => {
    setConfirmOpen(false)
    setConfirmStep(0)
    setPhase('working')
    setProgress({ done: 0, total: validRows.length })
    const out: ResultRow[] = []

    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + CHUNK_SIZE)
      let lastError = ''
      let data: unknown = null

      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await supabase.functions.invoke('bulk-delete-members', {
          body: { emails: chunk.map((r) => r.email) },
        })
        if (!result.error) {
          data = result.data
          break
        }
        lastError = await (async () => {
          try {
            const msg = result.error
            if (typeof msg === 'string') return msg
            if (msg && typeof msg === 'object' && 'message' in msg) return String((msg as { message: unknown }).message)
            return String(msg)
          } catch {
            return 'Unknown error'
          }
        })()
        if (!/failed to send a request|fetch failed|networkerror|load failed/i.test(lastError)) break
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
      }

      if (data) {
        type ApiResult = { email: string; ok: boolean; error?: string }
        const apiResults = ((data as { results?: ApiResult[] })?.results ?? []) as ApiResult[]
        for (const r of chunk) {
          const match = apiResults.find((a) => a.email === r.email)
          if (match) {
            out.push({
              index: r.index,
              email: r.email,
              status: match.ok ? 'deleted' : match.error === 'No account found with this email.' ? 'not_found' : 'failed',
              error: match.ok ? undefined : match.error,
            })
          } else {
            out.push({ index: r.index, email: r.email, status: 'failed', error: 'No response for this row.' })
          }
        }
      } else {
        for (const r of chunk) {
          out.push({ index: r.index, email: r.email, status: 'failed', error: lastError || 'Request failed.' })
        }
      }

      setProgress({ done: Math.min(i + CHUNK_SIZE, validRows.length), total: validRows.length })
    }

    setResults(out)
    setPhase('done')
  }

  const downloadTemplate = async () => {
    await downloadExcel(
      'ciie-bulk-delete-template.xlsx',
      [{ Email: 'user@kluniversity.in' }, { Email: 'another@kluniversity.in' }],
      'Emails to Delete',
    )
  }

  const downloadResults = () => {
    void downloadExcel(
      `ciie-bulk-delete-results-${new Date().toISOString().slice(0, 10)}.xlsx`,
      results.map((r) => ({
        Email: r.email,
        Status: r.status,
        Error: r.error ?? '',
      })),
      'Delete Results',
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk Delete Members"
        subtitle="Upload an Excel sheet with an Email column — preview all matching accounts, confirm, and permanently delete them."
        actions={
          <Button variant="ghost" onClick={() => void downloadTemplate()}>
            <Download size={15} /> Sample template
          </Button>
        }
      />

      {(phase === 'upload' || phase === 'preview') && (
        <div className="card p-6">
          <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-slate-900">
            <Upload size={16} className="text-red-600" /> Upload Excel / CSV
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Required column: <strong>Email</strong>. The file should contain one column with email addresses of members
            to delete. All other columns are ignored.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
              <FileSpreadsheet size={16} /> Choose file…
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void parseFile(f)
                  e.target.value = ''
                }}
              />
            </label>
            {fileName && <span className="text-sm text-slate-500">{fileName}</span>}
            {rows.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => {
                  setPhase('upload')
                  setRows([])
                  setResults([])
                  setFileName('')
                  if (fileRef.current) fileRef.current.value = ''
                }}
              >
                Clear
              </Button>
            )}
          </div>

          {parseError && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {parseError}
            </p>
          )}

          <div className="mt-5 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Warning — this is permanent</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-red-700/90">
                <li>You review every email before anything is deleted — each row shows whether an account exists.</li>
                <li>Only emails with a matching account are deleted; "no account" rows are skipped automatically.</li>
                <li>Each matching account is permanently deleted (auth account + profile).</li>
                <li>Super admin and main admin accounts are protected and will not be deleted.</li>
                <li>This action cannot be undone.</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {phase === 'preview' && rows.length > 0 && (
        <div className="card p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">
              Review before deleting — {validRows.length} will be deleted
              {notFoundCount > 0 && <span className="text-amber-600"> · {notFoundCount} no account — skipped</span>}
              {invalidCount - notFoundCount > 0 && (
                <span className="text-red-600"> · {invalidCount - notFoundCount} skipped</span>
              )}
            </h2>
            <Button
              variant="secondary"
              className="border-red-300 text-red-700 hover:bg-red-50"
              onClick={() => {
                setConfirmStep(1)
                setConfirmOpen(true)
              }}
              disabled={validRows.length === 0}
            >
              <Trash2 size={16} /> Delete {validRows.length} account{validRows.length === 1 ? '' : 's'}
            </Button>
          </div>

          <div className="max-h-[28rem] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.index} className={cn((r.error || !r.found) && 'bg-red-50/70')}>
                    <td className="px-3 py-2 text-slate-400">{r.index}</td>
                    <td className="px-3 py-2 text-slate-600">{r.email || '—'}</td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : r.found ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">
                          <CheckCircle2 size={13} /> Account exists
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                          <AlertTriangle size={13} /> No account
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                          <XCircle size={13} /> {r.error}
                        </span>
                      ) : r.found ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">
                          <CheckCircle2 size={13} /> Ready to delete
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                          <AlertTriangle size={13} /> Cannot delete
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invalidCount > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              Rows with errors are skipped — only the {validRows.length} valid rows above will be processed.
            </p>
          )}
        </div>
      )}

      {phase === 'working' && (
        <div className="card p-8">
          <div className="mx-auto max-w-md space-y-4 text-center">
            <div className="flex items-center justify-center gap-2 text-base font-bold text-slate-900">
              <SpinnerSmall />
              Deleting member accounts…
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-red-600 transition-all"
                style={{ width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
            <p className="text-sm text-slate-500">
              {progress.done} / {progress.total}
            </p>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Deleted" value={deletedCount} tone="green" />
            <StatCard label="Failed" value={failedCount} tone={failedCount > 0 ? 'red' : 'slate'} />
            <StatCard label="Not found" value={doneNotFoundCount} tone={doneNotFoundCount > 0 ? 'amber' : 'slate'} />
          </div>

          <div className="card p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900">Delete results ({results.length})</h2>
              <div className="flex flex-wrap gap-2">
                <Button onClick={downloadResults} disabled={results.length === 0}>
                  <Download size={15} /> Download results Excel
                </Button>
              </div>
            </div>

            <div className="max-h-[32rem] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((r, i) => (
                    <tr key={i} className={cn(r.status === 'failed' && 'bg-red-50/70')}>
                      <td className="px-3 py-2 text-slate-400">{r.index}</td>
                      <td className="px-3 py-2 text-slate-600">{r.email}</td>
                      <td className="px-3 py-2">
                        {r.status === 'deleted' ? (
                          <Badge tone="green">Deleted</Badge>
                        ) : r.status === 'not_found' ? (
                          <Badge tone="amber">Not found</Badge>
                        ) : (
                          <Badge tone="red">Failed</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{r.error ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setPhase('upload')
                setRows([])
                setResults([])
                setFileName('')
                if (fileRef.current) fileRef.current.value = ''
              }}
            >
              Delete another batch
            </Button>
          </div>
        </>
      )}

      {/* Confirmation modals */}
      <Modal
        open={confirmOpen && confirmStep === 1}
        onClose={() => { setConfirmOpen(false); setConfirmStep(0) }}
        title="Are you sure?"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setConfirmOpen(false); setConfirmStep(0) }}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              className="border-red-300 text-red-700 hover:bg-red-50"
              onClick={() => setConfirmStep(2)}
            >
              Yes, I want to proceed
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            You are about to <strong className="text-red-700">permanently delete</strong>{' '}
            <strong>{validRows.length}</strong> account{validRows.length === 1 ? '' : 's'}.
          </p>
          <p>This action cannot be undone. All profiles, auth accounts, and associated data will be removed.</p>
        </div>
      </Modal>

      <Modal
        open={confirmOpen && confirmStep === 2}
        onClose={() => { setConfirmOpen(false); setConfirmStep(0) }}
        title="Final confirmation"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setConfirmOpen(false); setConfirmStep(0) }}>
              Cancel
            </Button>
            <Button
              onClick={() => void runDelete()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              <Trash2 size={16} /> Permanently delete {validRows.length} account{validRows.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            This is your <strong className="text-red-700">last chance</strong>. Type nothing — just click the button
            below to confirm.
          </p>
          <p>
            <strong>{validRows.length}</strong> accounts will be deleted immediately. This is irreversible.
          </p>
        </div>
      </Modal>
    </div>
  )
}

function SpinnerSmall() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-red-600" />
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'green' | 'red' | 'amber' | 'slate' }) {
  const tones = {
    green: 'border-green-200 bg-green-50 text-green-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
  }
  return (
    <div className={cn('rounded-xl border px-4 py-3', tones[tone])}>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</p>
    </div>
  )
}
