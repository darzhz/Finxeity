export const DEFAULT_CURRENCY = 'INR'
export const DEFAULT_LOCALE = 'en-IN'

const formatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
  style: 'currency',
  currency: DEFAULT_CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const plainFormatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Formats integer paise as an INR string, e.g. 45000 -> "₹450.00". */
export function formatMinor(minor: number): string {
  return formatter.format(minor / 100)
}

/** Formats integer paise without a currency symbol, e.g. 45000 -> "450.00". */
export function formatMinorPlain(minor: number): string {
  return plainFormatter.format(minor / 100)
}

/**
 * Parses user input in rupees into integer paise. Accepts "1,234.5", "1234",
 * "₹1,234.50". Returns null when the input is not a valid amount.
 */
export function parseMajorToMinor(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '')
  if (cleaned === '') return null
  if (!/^\d*(\.\d{0,2})?$/.test(cleaned)) return null
  const value = Number.parseFloat(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}
