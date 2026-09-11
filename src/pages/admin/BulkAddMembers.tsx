import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ClipboardCopy,
  Copy,
  Download,
  FileSpreadsheet,
  Info,
  MailCheck,
  RotateCcw,
  TriangleAlert,
  Upload,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { Badge, Button, Modal, PageHeader, SelectInput } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { fetchAllProfiles } from '@/lib/queries'
import { ROLE_LABELS } from '@/lib/types'
import { downloadExcel } from '@/lib/excel'
import { cn, digitsOnly, emailInvokeMessage, errorMessage } from '@/lib/utils'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CHUNK_SIZE = 15
const STORAGE_KEY = 'ciie_bulk_add_state'

type Phase = 'upload' | 'preview' | 'working' | 'done'

interface ParsedRow {
  index: number
  fullName: string
  email: string
  studentId: string
  department: string
  yearOfStudy: string
  phone: string
  error: string | null
}

interface ResultRow extends ParsedRow {
  status: 'created' | 'failed' | 'pending'
  password?: string
  mailStatus?: 'sent' | 'failed'
  mailUsed?: string
  mailError?: string
  resultError?: string
  role?: string
}

interface SavedState {
  phase: Phase
  stage?: 'create' | 'mail'
  processedCount?: number
  sentMails?: number[]
  results: ResultRow[]
  validRows?: ParsedRow[]
  fileName: string
  importRole: string
  timestamp: number
}

const IMPORTABLE_ROLES = ['user', 'member', 'member_ciie', 'faculty'] as const

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z]/g, '')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function mapHeaders(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const h of headers) {
    const n = normHeader(String(h))
    if (!n) continue
    if (map.student === undefined && (n.includes('studentid') || n.includes('idnumber') || n === 'id' || n.includes('rollno') || n.includes('rollnumber') || n.includes('hallticket'))) map.student = h
    else if (map.phone === undefined && (n.includes('mobile') || n.includes('phone') || n.includes('whatsapp') || n.includes('contactno') || n === 'contact')) map.phone = h
    else if (map.email === undefined && (n.includes('email') || n === 'mail' || n.includes('mailid'))) map.email = h
    else if (map.name === undefined && n.includes('name')) map.name = h
    else if (map.department === undefined && (n.includes('dept') || n.includes('department') || n.includes('branch'))) map.department = h
    else if (map.year === undefined && n.includes('year')) map.year = h
  }
  return map
}

function loadSavedState(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedState
    if (!parsed.phase) return null
    return parsed
  } catch {
    return null
  }
}

function saveState(phase: Phase, results: ResultRow[], fileName: string, importRole: string) {
  try {
    const state: SavedState = { phase, results, fileName, importRole, timestamp: Date.now() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* quota exceeded or private browsing — ignore */ }
}

function clearSavedState() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

function saveWorkingState(stage: 'create' | 'mail', processedCount: number, results: ResultRow[], sentMails: number[], validRows: ParsedRow[], fileName: string, importRole: string) {
  try {
    const state: SavedState = { phase: 'working', stage, processedCount, sentMails, results, validRows, fileName, importRole, timestamp: Date.now() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* quota exceeded or private browsing — ignore */ }
}

export default function BulkAddMembers() {
  const saved = loadSavedState()
  const hasSavedWorking = saved?.phase === 'working'

  const [phase, setPhase] = useState<Phase>(hasSavedWorking ? 'working' : saved?.phase === 'done' ? 'done' : 'upload')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState(hasSavedWorking ? (saved.fileName ?? '') : saved?.phase === 'done' ? (saved.fileName ?? '') : '')
  const [parseError, setParseError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [importRole, setImportRole] = useState<(typeof IMPORTABLE_ROLES)[number]>((hasSavedWorking ? saved.importRole : saved?.importRole) as (typeof IMPORTABLE_ROLES)[number] ?? 'user')

  const [stage, setStage] = useState<'create' | 'mail'>(hasSavedWorking ? (saved.stage ?? 'create') : 'create')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<ResultRow[]>(hasSavedWorking ? (saved.results ?? []) : saved?.phase === 'done' ? (saved.results ?? []) : [])
  const [showPasswords, setShowPasswords] = useState(true)
  const [copied, setCopied] = useState(false)
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)
  const [exitConfirmStep, setExitConfirmStep] = useState(0)
  const [resumeOpen, setResumeOpen] = useState(hasSavedWorking)
  const [resumed, setResumed] = useState(hasSavedWorking)
  const fileRef = useRef<HTMLInputElement>(null)

  const validRows = useMemo(() => resumed ? [] : rows.filter((r) => !r.error), [rows, resumed])
  const invalidCount = rows.length - validRows.length
  const dupCount = rows.filter((r) => r.error?.includes('already exists')).length

  const created = useMemo(() => results.filter((r) => r.status === 'created'), [results])
  const mailSent = created.filter((r) => r.mailStatus === 'sent').length
  const mailFailed = created.filter((r) => r.mailStatus === 'failed').length

  // Persist to localStorage whenever results change in done phase
  useEffect(() => {
    if (phase === 'done' && results.length > 0) {
      saveState('done', results, fileName, importRole)
    }
  }, [phase, results, fileName, importRole])

  // Network reconnect: reload saved state
  useEffect(() => {
    const handleOnline = () => {
      const reloaded = loadSavedState()
      if (!reloaded) return
      if (reloaded.phase === 'working') {
        setResults(reloaded.results ?? [])
        setFileName(reloaded.fileName ?? '')
        setStage(reloaded.stage ?? 'create')
        setResumeOpen(true)
        setPhase('working')
      } else if (reloaded.phase === 'done' && reloaded.results.length > 0) {
        setResults(reloaded.results)
        setFileName(reloaded.fileName ?? '')
        setPhase('done')
      }
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  const resumeImport = () => {
    setResumeOpen(false)
    setResumed(true)
    const re = loadSavedState()
    if (!re || re.phase !== 'working') return
    setResults(re.results ?? [])
    setFileName(re.fileName ?? '')
    setImportRole(re.importRole as (typeof IMPORTABLE_ROLES)[number])
    setStage(re.stage ?? 'create')
    setPhase('working')
    const valid = re.validRows ?? []
    const processed = re.processedCount ?? 0
    if (re.stage === 'create') {
      setProgress({ done: processed, total: valid.length })
      void runImport(valid, 'create', processed, re.results ?? [])
    } else {
      const res = re.results ?? []
      const createdList = res.filter((r) => r.status === 'created')
      const sentMails = re.sentMails ?? []
      const mailed = createdList.filter((r) => sentMails.includes(r.index)).length
      setProgress({ done: mailed, total: createdList.length })
      void runImport(valid, 'mail', 0, res, sentMails)
    }
  }

  const dismissResume = () => {
    setResumeOpen(false)
    setResumed(false)
    clearSavedState()
    setPhase('upload')
    setResults([])
    setRows([])
    setFileName('')
  }

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
      const missing = ['name', 'student', 'email', 'phone'].filter((k) => !col[k])
      if (missing.length > 0) {
        throw new Error(
          `Could not find these required column(s): ${missing
            .map((m) => ({ name: 'Name', student: 'Id Number', email: 'Email', phone: 'Mobile Number' })[m])
            .join(', ')}. Found columns: ${headers.join(', ')}.`,
        )
      }

      const emailsInFile = new Set<string>()
      const idsInFile = new Set<string>()

      const parsed: ParsedRow[] = raw.map((r, i) => {
        const fullName = String(r[col.name!] ?? '').replace(/\s+/g, ' ').trim()
        const email = String(r[col.email!] ?? '').trim().toLowerCase()
        const studentId = digitsOnly(String(r[col.student!] ?? ''))
        const phone = digitsOnly(String(r[col.phone!] ?? ''))
        const department = String(r[col.department ?? '__'] ?? '').trim()
        const yearOfStudy = String(r[col.year ?? '__'] ?? '').trim()

        let error: string | null = null
        if (!fullName) error = 'Name is missing.'
        else if (!EMAIL_RE.test(email)) error = 'Email is invalid.'
        else if (studentId.length !== 10) error = `Student ID must be exactly 10 digits (got ${studentId.length}).`
        else if (phone.length !== 10) error = `Phone number must be exactly 10 digits (got ${phone.length}).`
        else if (emailsInFile.has(email)) error = 'Duplicate email in this file.'
        else if (idsInFile.has(studentId)) error = 'Duplicate Student ID in this file.'
        emailsInFile.add(email)
        idsInFile.add(studentId)

        return { index: i + 1, fullName, email, studentId, department, yearOfStudy, phone, error }
      })

      const existing = await fetchAllProfiles<{ email: string | null; student_id: string | null }>('email, student_id')
      const dbEmails = new Set(existing.map((p) => String(p.email ?? '').trim().toLowerCase()))
      const dbIds = new Set(existing.map((p) => digitsOnly(p.student_id)))
      for (const row of parsed) {
        if (row.error) continue
        if (dbEmails.has(row.email)) row.error = 'An account with this email already exists.'
        else if (dbIds.has(row.studentId)) row.error = 'A member with this Student ID already exists.'
      }

      setRows(parsed)
      setPhase('preview')
    } catch (err) {
      setParseError(errorMessage(err))
      setRows([])
    }
  }, [])

  const invokeChunk = async (body: Record<string, unknown>) => {
    let lastError = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase.functions.invoke('bulk-create-members', { body })
      if (!error) return data
      lastError = await emailInvokeMessage(error)
      if (!/failed to send a request|fetch failed|networkerror|load failed/i.test(lastError)) throw new Error(lastError)
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
    }
    throw new Error(
      `${lastError} — the Edge Function could not be reached after retries. Make sure the project is active and 'bulk-create-members' is deployed, then try again.`,
    )
  }

  const runImport = async (
    inputRows?: ParsedRow[],
    resumeStage?: 'create' | 'mail',
    resumeFrom?: number,
    prevResults?: ResultRow[],
    sentMails?: number[],
  ) => {
    setConfirmOpen(false)
    if (!resumeStage) setPhase('working')
    const currentRows = inputRows ?? validRows
    const startStage = resumeStage ?? 'create'
    const startFrom = resumeFrom ?? 0
    const out: ResultRow[] = prevResults ? [...prevResults] : []

    if (startStage === 'create') {
      setStage('create')
      setProgress({ done: startFrom, total: currentRows.length })

      for (let i = startFrom; i < currentRows.length; i += CHUNK_SIZE) {
        const chunk = currentRows.slice(i, i + CHUNK_SIZE)
        try {
          const data = await invokeChunk({
            role: importRole,
            members: chunk.map((r, j) => ({
              client_index: i + j,
              full_name: r.fullName,
              email: r.email,
              student_id: r.studentId,
              department: r.department,
              year_of_study: r.yearOfStudy,
              phone: r.phone,
            })),
          })
          type ApiResult = { index: number; client_index: number | null; ok: boolean; error?: string; password?: string }
          const api = ((data as { results?: ApiResult[] })?.results ?? []) as ApiResult[]
          for (let j = 0; j < chunk.length; j++) {
            const match = api.find((a) => a.client_index === i + j)
            out.push({
              ...chunk[j],
              status: match?.ok ? 'created' : 'failed',
              password: match?.password,
              role: importRole,
              resultError: match?.ok ? undefined : match?.error ?? 'No response for this row.',
            })
          }
        } catch (err) {
          for (const r of chunk) out.push({ ...r, status: 'failed', role: importRole, resultError: errorMessage(err) })
        }
        setProgress({ done: Math.min(i + CHUNK_SIZE, currentRows.length), total: currentRows.length })
        setResults([...out])
        saveWorkingState('create', Math.min(i + CHUNK_SIZE, currentRows.length), out, [], currentRows, fileName, importRole)
      }
    }

    const mailList = out.filter((r) => r.status === 'created')
    const sentSet = new Set(sentMails ?? [])
    setStage('mail')
    setProgress({ done: 0, total: mailList.length })
    let mailed = 0
    for (const r of mailList) {
      if (sentSet.has(r.index)) {
        mailed += 1
        setProgress({ done: mailed, total: mailList.length })
        continue
      }
      const { account, error: mailErr } = await sendWelcomeMail(r)
      r.mailStatus = account ? 'sent' : 'failed'
      if (account) r.mailUsed = account
      if (mailErr) r.mailError = mailErr
      mailed += 1
      setProgress({ done: mailed, total: mailList.length })
      setResults([...out])
      const allSent = mailList.filter((m) => m.mailStatus === 'sent').map((m) => m.index)
      saveWorkingState('mail', 0, out, allSent, currentRows, fileName, importRole)
    }

    setResults(out)
    clearSavedState()
    setPhase('done')
  }

  const sendWelcomeMail = async (r: ResultRow): Promise<{ account: string | null; error: string | null }> => {
    const loginUrl = `${window.location.origin}/login`
    const text =
      `Hi ${r.fullName},\n\n` +
      'Your KL CIIE account has been created.\n\n' +
      `Login Email: ${r.email}\n` +
      `Password: ${r.password}\n\n` +
      `Log in here: ${loginUrl}\n\n` +
      'Please keep this email safe and do not share your password.\n\n' +
      'Regards,\nKL CIIE'
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">' +
      '<div style="background:#4f46e5;padding:20px 26px;text-align:center">' +
      '<span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:1px">KL CIIE</span></div>' +
      `<div style="padding:26px;color:#0f172a;font-size:15px;line-height:1.6"><h2 style="margin:0 0 12px">Hi ${escapeHtml(r.fullName)},</h2>` +
      '<p style="margin:0 0 14px">Your KL CIIE account has been created. Use these details to log in:</p>' +
      '<table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px">' +
      `<tr><td style="padding:10px 14px;font-weight:600">Login Email</td><td style="padding:10px 14px">${escapeHtml(r.email)}</td></tr>` +
      `<tr><td style="padding:10px 14px;font-weight:600">Student ID</td><td style="padding:10px 14px">${escapeHtml(r.studentId)}</td></tr>` +
      `<tr><td style="padding:10px 14px;font-weight:600">Password</td><td style="padding:10px 14px"><strong style="font-family:monospace;font-size:16px">${escapeHtml(r.password ?? '')}</strong></td></tr>` +
      '</table>' +
      `<p style="margin:14px 0">Log in at <a href="${loginUrl}">${loginUrl}</a>.</p>` +
      '<p style="margin:0">Please keep this email safe and do not share your password.<br/><strong>KL CIIE</strong></p>' +
      '</div></div>'
    try {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 12000)
      const { data, error } = await supabase.functions.invoke('send-recruit-email', {
        body: { to_email: r.email, subject: 'Your KL CIIE account', text, html },
        signal: controller.signal,
      })
      window.clearTimeout(timer)
      if (error) {
        const msg = await emailInvokeMessage(error)
        return { account: null, error: msg }
      }
      const account = (data as { account?: string } | null)?.account
      return { account: typeof account === 'string' && account ? account : 'unknown sender', error: null }
    } catch (e) {
      return { account: null, error: errorMessage(e) }
    }
  }

  const resendMail = async (row: ResultRow) => {
    const { account, error: mailErr } = await sendWelcomeMail(row)
    setResults((prev) => {
      const next = prev.map((r) => {
        if (r.index !== row.index) return r
        return {
          ...r,
          mailStatus: (account ? 'sent' : 'failed') as 'sent' | 'failed',
          mailUsed: account ?? r.mailUsed,
          mailError: mailErr ?? undefined,
        }
      })
      if (phase === 'done') saveState('done', next, fileName, importRole)
      return next
    })
  }

  const downloadTemplate = async () => {
    await downloadExcel(
      'ciie-bulk-add-members-template.xlsx',
      [{ Name: 'Rahul Kumar', 'Id Number': '2300123456', Email: 'rahul@kluniversity.in', Department: 'CSE', Year: '2nd Year', 'Mobile Number': '9876543210' }],
      'Members',
    )
  }

  const copyCredentials = async () => {
    const lines = created.map((r) => `${r.fullName}\t${r.email}\t${r.studentId}\t${r.password ?? ''}`)
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadCredentials = () => {
    void downloadExcel(
      `ciie-bulk-members-${new Date().toISOString().slice(0, 10)}.xlsx`,
      created.map((r) => ({
        Name: r.fullName,
        Email: r.email,
        'Student ID': r.studentId,
        Password: r.password ?? '',
        Role: ROLE_LABELS[(r.role ?? 'user') as keyof typeof ROLE_LABELS],
        Department: r.department,
        Year: r.yearOfStudy,
        Phone: r.phone,
        EmailStatus: r.mailStatus === 'sent' ? 'sent' : r.mailStatus === 'failed' ? 'failed' : '',
        'Mail Used': r.mailStatus === 'sent' ? r.mailUsed ?? '' : 'Not sent',
        'Mail Error': r.mailError ?? '',
      })),
      'Credentials',
    )
  }

  const handleExit = () => {
    clearSavedState()
    setResumed(false)
    setPhase('upload')
    setRows([])
    setResults([])
    setFileName('')
    setExitConfirmOpen(false)
    setExitConfirmStep(0)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk Add Members"
        subtitle="Upload an Excel sheet of members — preview everyone, create their login accounts with random passwords, and email the credentials automatically."
        actions={
          <Button variant="ghost" onClick={() => void downloadTemplate()}>
            <Download size={15} /> Sample template
          </Button>
        }
      />

      {(phase === 'upload' || phase === 'preview') && (
        <div className="card p-6">
          <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-slate-900">
            <Upload size={16} className="text-primary-600" /> Upload Excel / CSV
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Required columns: <strong>Name</strong>, <strong>Id Number</strong> (Student ID), <strong>Email</strong>,{' '}
            <strong>Department</strong>, <strong>Year</strong>, <strong>Mobile Number</strong> (Phone). Student ID and
            phone must be exactly 10 digits. Extra columns are ignored.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700">
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
            <div className="flex items-center gap-2">
              <label className="whitespace-nowrap text-sm font-semibold text-slate-700" htmlFor="bulk-import-role">
                Create accounts as
              </label>
              <div className="w-44">
                <SelectInput id="bulk-import-role" value={importRole} onChange={(e) => setImportRole(e.target.value as (typeof IMPORTABLE_ROLES)[number])}>
                  {IMPORTABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </SelectInput>
              </div>
            </div>
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
              <TriangleAlert size={15} className="mt-0.5 shrink-0" /> {parseError}
            </p>
          )}

          <div className="mt-5 flex items-start gap-2 rounded-xl bg-primary-50 px-4 py-3 text-sm text-primary-800">
            <Info size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">What happens next</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-primary-700/90">
                <li>You review every person from the sheet before anything is created.</li>
                <li>Each member gets a login account with a random password.</li>
                <li>Welcome emails (email + name + password) are sent automatically.</li>
                <li>If one SMTP fails, the next one is tried automatically until one works.</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {phase === 'preview' && rows.length > 0 && (
        <div className="card p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">
              Review before creating — {validRows.length} ready
              {dupCount > 0 && <span className="text-amber-600"> · {dupCount} already exist — skipped</span>}
              {invalidCount - dupCount > 0 && (
                <span className="text-red-600"> · {invalidCount - dupCount} skipped</span>
              )}
              <span className="ml-2 text-sm font-medium text-slate-500">· role: {ROLE_LABELS[importRole]}</span>
            </h2>
            <Button onClick={() => setConfirmOpen(true)} disabled={validRows.length === 0}>
              <UserPlus size={16} /> Create {validRows.length} account{validRows.length === 1 ? '' : 's'} &amp; send mails
            </Button>
          </div>

          <div className="max-h-[28rem] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Student ID</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Dept</th>
                  <th className="px-3 py-2">Year</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.index} className={cn(r.error && 'bg-red-50/70')}>
                    <td className="px-3 py-2 text-slate-400">{r.index}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{r.fullName || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.studentId || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.email}</td>
                    <td className="px-3 py-2 text-slate-600">{r.department || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.yearOfStudy || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.phone || '—'}</td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                          <XCircle size={13} /> {r.error}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">
                          <CheckCircle2 size={13} /> Ready
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
              Rows with errors are skipped — fix them in your sheet and upload again. Only the {validRows.length} valid
              rows above will be created.
            </p>
          )}
        </div>
      )}

      {phase === 'working' && (
        <div className="card p-8">
          <div className="mx-auto max-w-md space-y-4 text-center">
            <div className="flex items-center justify-center gap-2 text-base font-bold text-slate-900">
              <SpinnerSmall />
              {stage === 'create' ? 'Creating member accounts…' : 'Sending welcome emails…'}
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-primary-600 transition-all"
                style={{ width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
            <p className="text-sm text-slate-500">
              {progress.done} / {progress.total}{' '}
              {stage === 'mail' && progress.total === 0 && '— no accounts were created, skipping emails.'}
            </p>
          </div>

          <div className="mt-6 flex justify-center">
            <Button
              variant="secondary"
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => {
                setExitConfirmStep(1)
                setExitConfirmOpen(true)
              }}
            >
              Load New List
            </Button>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Created" value={created.length} tone="green" />
            <StatCard label="Failed" value={results.length - created.length} tone={results.length - created.length > 0 ? 'red' : 'slate'} />
            <StatCard label="Emails sent" value={mailSent} tone="green" />
            <StatCard label="Emails failed" value={mailFailed} tone={mailFailed > 0 ? 'amber' : 'slate'} />
          </div>

          {mailFailed > 0 && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Some welcome emails failed (SMTP issue or rate limit). Use the resend button next to those members below —
              account creation itself succeeded for every "Created" row.
            </p>
          )}
          <p className="flex items-start gap-2 rounded-xl bg-primary-50 px-4 py-3 text-sm text-primary-800">
            <Info size={16} className="mt-0.5 shrink-0" />
            Passwords are shown here only while this page is open — they cannot be recovered later. Download the Excel
            file below to keep a permanent record. Your results are saved locally so refreshing this page will restore
            them.
          </p>

          <div className="card p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900">Accounts &amp; passwords ({created.length})</h2>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setShowPasswords((v) => !v)}>
                  {showPasswords ? 'Hide passwords' : 'Show passwords'}
                </Button>
                <Button variant="ghost" onClick={() => void copyCredentials()} disabled={copied}>
                  {copied ? <ClipboardCopy size={15} /> : <Copy size={15} />} {copied ? 'Copied!' : 'Copy all'}
                </Button>
                <Button onClick={downloadCredentials} disabled={created.length === 0}>
                  <Download size={15} /> Download credentials Excel
                </Button>
              </div>
            </div>

            <div className="max-h-[32rem] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[60rem] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Student ID</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Password</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Mail used</th>
                    <th className="px-3 py-2">Mail status</th>
                    <th className="px-3 py-2">Mail error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((r) => (
                    <tr key={r.index} className={cn(r.status === 'failed' && 'bg-red-50/70')}>
                      <td className="px-3 py-2 text-slate-400">{r.index}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{r.fullName}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.studentId}</td>
                      <td className="px-3 py-2 text-slate-600">{r.email}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.status === 'created' ? (showPasswords ? r.password : '••••••••') : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {r.status === 'created' ? (
                          <Badge tone="green">Created</Badge>
                        ) : (
                          <Badge tone="red" className="max-w-56 truncate">
                            <XCircle size={12} /> {r.resultError}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-green-700">
                        {r.status === 'created' && r.mailStatus === 'sent' ? r.mailUsed ?? '—' : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {r.status !== 'created' ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : r.mailStatus === 'sent' ? (
                          <Badge tone="green"><MailCheck size={12} /> Sent</Badge>
                        ) : r.mailStatus === 'failed' ? (
                          <Badge tone="red">Failed</Badge>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-48">
                        {r.status === 'created' && r.mailStatus === 'failed' && r.mailError ? (
                          <span className="text-xs text-red-600 truncate block" title={r.mailError}>{r.mailError}</span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.status === 'created' && r.mailStatus === 'failed' ? (
                          <button
                            className="inline-flex items-center gap-1 rounded-lg bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100"
                            title="Resend welcome email"
                            onClick={() => void resendMail(r)}
                          >
                            <RotateCcw size={12} /> Resend
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => {
                setExitConfirmStep(1)
                setExitConfirmOpen(true)
              }}
            >
              Load New List
            </Button>
          </div>
        </>
      )}

      {/* Create confirmation */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Create accounts?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void runImport()}>
              <UserPlus size={16} /> Yes, create {validRows.length} account{validRows.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-sm text-slate-600">
          <li>• {validRows.length} login account(s) will be created with random passwords.</li>
          <li>
            • Every account will be created with the role{' '}
            <strong className="text-slate-900">{ROLE_LABELS[importRole]}</strong>.
          </li>
          <li>• A welcome email with name, email and password will be sent to each member.</li>
          <li>• Emails rotate across your configured Gmail SMTP accounts with automatic failover.</li>
          <li>• This can take several minutes for large batches — keep this page open.</li>
        </ul>
      </Modal>

      {/* Exit confirmation step 1 */}
      <Modal
        open={exitConfirmOpen && exitConfirmStep === 1}
        onClose={() => { setExitConfirmOpen(false); setExitConfirmStep(0) }}
        title="Load a new list?"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setExitConfirmOpen(false); setExitConfirmStep(0) }}>
              Stay here
            </Button>
            <Button
              variant="secondary"
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => setExitConfirmStep(2)}
            >
              Continue
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            {phase === 'working'
              ? 'The current import is still in progress. If you leave now, the remaining accounts will not be created and emails will not be sent.'
              : 'Your current results will be cleared from this page.'}
          </p>
          <p>Are you sure you want to load a new list?</p>
        </div>
      </Modal>

      {/* Exit confirmation step 2 */}
      <Modal
        open={exitConfirmOpen && exitConfirmStep === 2}
        onClose={() => { setExitConfirmOpen(false); setExitConfirmStep(0) }}
        title="Final confirmation"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setExitConfirmOpen(false); setExitConfirmStep(0) }}>
              Cancel
            </Button>
            <Button
              onClick={handleExit}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              Yes, load new list
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            {phase === 'working'
              ? 'The current import will be abandoned. Any remaining accounts will not be created.'
              : 'All results from this batch will be permanently cleared from this page.'}
          </p>
          <p>Click the button below to confirm.</p>
        </div>
      </Modal>

      {/* Resume interrupted import */}
      <Modal
        open={resumeOpen}
        onClose={() => {}}
        title="Resume previous import?"
        footer={
          <>
            <Button variant="ghost" onClick={dismissResume}>
              Start new batch
            </Button>
            <Button onClick={resumeImport}>
              <RotateCcw size={16} /> Resume
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>A previous import was interrupted before it finished.</p>
          <p>Would you like to <strong>resume</strong> where it left off, or <strong>start a new batch</strong>?</p>
          {saved?.phase === 'working' && (
            <ul className="list-disc space-y-1 pl-4 text-slate-500">
              <li>Stage: <strong>{saved.stage === 'mail' ? 'Sending emails' : 'Creating accounts'}</strong></li>
              <li>{saved.results?.length ?? 0} member(s) processed so far</li>
              <li>File: {saved.fileName ?? 'Unknown'}</li>
            </ul>
          )}
        </div>
      </Modal>
    </div>
  )
}

function SpinnerSmall() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
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
