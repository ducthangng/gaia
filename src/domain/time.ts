export const toMin = (t: string | null | undefined): number | null => {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return Number.isNaN(h) ? null : h * 60 + (m || 0)
}

export const parseDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}

export const formatDate = (date: Date) => date.toISOString().slice(0, 10)

export const addDays = (d: string, n: number) => {
  const x = parseDate(d)
  x.setUTCDate(x.getUTCDate() + n)
  return formatDate(x)
}

export const diffDays = (a: string, b: string) => (parseDate(a).getTime() - parseDate(b).getTime()) / 86400000

export const weekDates = (startDate: string) => Array.from({ length: 7 }, (_, i) => addDays(startDate, i))

/** 0 = Thứ Hai ... 6 = Chủ Nhật */
export const dayIndex = (d: string) => (parseDate(d).getUTCDay() + 6) % 7

export const DAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN']

export const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export const dayLabel = (d: string) => `${DAY_LABELS[dayIndex(d)]} ${shortDate(d)}`

export const money = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`

export const SESSION_LABEL = { AM: 'Sáng', PM: 'Chiều' } as const
