const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const dayFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const monthFormatter = new Intl.DateTimeFormat('en-IN', { month: 'short' })

export function formatDateTime(timestamp: number): string {
  if (!timestamp) return '—'
  return dateTimeFormatter.format(new Date(timestamp))
}

export function formatDay(timestamp: number): string {
  if (!timestamp) return '—'
  return dayFormatter.format(new Date(timestamp))
}

export function formatMonth(timestamp: number): string {
  if (!timestamp) return '—'
  return monthFormatter.format(new Date(timestamp))
}

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '—'
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDay(timestamp)
}
