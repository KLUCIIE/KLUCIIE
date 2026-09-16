import { TextInput } from '@/components/ui'
import { normalizePhone } from '@/lib/utils'

/**
 * Legacy helper kept for callers that read `.number`. Country codes are no
 * longer stored or displayed — the value is a plain 10-digit subscriber number.
 */
export function parsePhone(value: string | undefined): { dial: string; number: string } {
  return { dial: '+91', number: normalizePhone(value) }
}

export default function PhoneInput({
  value,
  onChange,
  placeholder = '98765 43210',
  disabled,
  required,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
}) {
  const number = normalizePhone(value)

  return (
    <TextInput
      inputMode="tel"
      disabled={disabled}
      required={required}
      value={number}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '')
        onChange(digits.length > 10 ? normalizePhone(digits) : digits.slice(0, 10))
      }}
      placeholder={placeholder}
      className="min-w-0 flex-1"
    />
  )
}
