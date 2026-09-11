import { CircleSlash } from 'lucide-react'
import { Button, Modal } from '@/components/ui'

export default function RegistrationsClosed({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Registrations are closed"
      footer={
        <Button onClick={onClose} variant="secondary">
          Back to home
        </Button>
      }
    >
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
          <CircleSlash size={20} />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Registration deadline has passed</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Registrations are closed. New applications are no longer being accepted for this period.
          </p>
        </div>
      </div>
    </Modal>
  )
}