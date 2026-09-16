import { Button, Modal } from '@/components/ui'
import { MailCheck } from 'lucide-react'
import type { PlatformSettings } from '@/lib/types'

function formatDomain(d: string): string {
  return `@${d.trim().toLowerCase().replace(/^@/, '')}`
}

export function OAuthDomainNotice({
  open,
  onClose,
  onConfirm,
  settings,
  provider,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  settings: PlatformSettings
  provider: 'github' | 'microsoft'
}) {
  const domains = (settings.signup_allowed_domains ?? [])
    .map(formatDomain)
    .filter(Boolean)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sign-in requires an allowed email"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>I understand, continue</Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
          <MailCheck size={20} />
        </div>
        <div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {provider === 'github'
              ? 'Only accounts with an email from an allowed domain can sign in through GitHub.'
              : 'Only accounts with an email from an allowed domain can sign in through Microsoft.'}
          </p>
          {domains.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {domains.map((d) => (
                <span
                  key={d}
                  className="rounded-lg bg-primary-50 px-3 py-1 text-sm font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                >
                  {d}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              No allowed domains are configured. Ask a CIIE admin to enable allowed domains in Settings.
            </p>
          )}
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            If the email on your {provider === 'github' ? 'GitHub' : 'Microsoft'} account isn't from one of these domains, sign-in will be blocked after you authorize.
          </p>
        </div>
      </div>
    </Modal>
  )
}