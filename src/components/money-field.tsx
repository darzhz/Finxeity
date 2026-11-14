import { formatMinor } from '@/lib/money'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const currencySymbol = formatMinor(0).replace(/[\d.,\s-]/g, '') || '₹'
const cleanAmount = (value: string) => value.replace(/[^\d.]/g, '')

export function MoneyField({
  label,
  value,
  onChange,
  placeholder = '0',
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {currencySymbol}
        </span>
        <Input
          className="h-11 pl-8 tabular-nums"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(cleanAmount(event.target.value))}
        />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
