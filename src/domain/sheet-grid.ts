import { addDays } from './time'
import type { Lesson, LessonType, Session } from './types'

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

export function sheetIdFromUrl(url: string): string | null {
  return url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim()) ? url.trim() : null)
}

export const gvizCsvUrl = (id: string, tab: string) =>
  `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=0&sheet=${encodeURIComponent(tab)}`

const cleanCell = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim() || null

const fmtTime = (v: string | null) => {
  const m = v?.match(/^(\d{1,2})\s*[hH:]\s*(\d{0,2})/)
  return m ? `${m[1].padStart(2, '0')}:${(m[2] || '0').padStart(2, '0')}` : null
}

export interface ParsedTeacher {
  id: string
  name: string
  phone: string | null
  district: string | null
  address: string | null
  office: string | null
}

export type ParsedLesson = Omit<Lesson, 'id' | 'weekId' | 'schoolId'> & { schoolName: string }

/** Lấy thứ Hai của tuần từ dòng 1: ưu tiên ô ngày, sau đó tiêu đề "CẬP NHẬT TUẦN 02/11 - 08/11". */
export function detectMonday(grid: string[][], fallbackYear: number): string | null {
  const first = grid[0]?.[5]?.trim()
  const iso = first?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  const dmy = first?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  const title = grid[0]?.[0]?.match(/(\d{1,2})\/(\d{1,2})\s*-/)
  return title ? `${fallbackYear}-${title[2].padStart(2, '0')}-${title[1].padStart(2, '0')}` : null
}

const BLOCK = 22
const OFFSET = { school: 0, company: 1, cls: 2, subject: 3, start: 4, end: 5, note: 6, code: 7 }
const TRACK2 = 8
const DAY_COL = 5
const EVENT_CODES = new Set(['BCTH', 'BCTH/2', 'BCCĐ', 'ĐP', 'HN', 'KI', 'BN', 'HT', 'TQ', 'CA', 'NB'])

/**
 * Đọc tab tuần của Google Sheet theo đúng bố cục workbook: mỗi GV 22 dòng, mỗi ngày 12 cột.
 * CSV không mang màu ô nên trạng thái nghỉ/dạy thay chỉ nhận qua mã quy đổi và ghi chú.
 */
export function parseWeekGrid(grid: string[][], monday: string): { teachers: ParsedTeacher[]; lessons: ParsedLesson[] } {
  const teachers: ParsedTeacher[] = []
  const lessons: ParsedLesson[] = []
  const cell = (r: number, c: number) => cleanCell(grid[r]?.[c])
  for (let i = 3; cell(i, 4) === 'TRƯỜNG'; i += BLOCK) {
    const id = cell(i, 0)
    const name = cell(i, 1)
    if (!id || !name) continue
    const phone = cell(i + 1, 1)
    teachers.push({ id, name, phone: phone && /^[\d .]+$/.test(phone) ? phone : null, district: cell(i, 2), address: cell(i, 3), office: cell(i + 1, 3) })
    for (const [track, top] of [[0, i], [1, i + TRACK2]] as const) {
      for (let d = 0; d < 7; d++) {
        for (let k = 0; k < 12; k++) {
          const c = DAY_COL + d * 12 + k
          const schoolName = cell(top + OFFSET.school, c)
          if (!schoolName) continue
          const rawCode = cell(top + OFFSET.code, c)
          const code = rawCode && rawCode.length <= 6 ? rawCode : null
          const note = cell(top + OFFSET.note, c) ?? (code ? null : rawCode)
          const session: Session = k < 6 ? 'AM' : 'PM'
          const type: LessonType = code === 'CM' ? 'support' : code && EVENT_CODES.has(code) ? 'event' : /d[aạ]y thay|\bDT\b/i.test(note ?? '') ? 'substitute' : 'regular'
          lessons.push({
            schoolName,
            teacherId: id,
            originalTeacherId: null,
            date: addDays(monday, d),
            session,
            period: k % 6 + 1,
            track,
            className: cell(top + OFFSET.cls, c),
            subject: cell(top + OFFSET.subject, c),
            start: fmtTime(cell(top + OFFSET.start, c)),
            end: fmtTime(cell(top + OFFSET.end, c)),
            code,
            company: cell(top + OFFSET.company, c),
            note,
            type,
            status: 'assigned',
          })
        }
      }
    }
  }
  return { teachers, lessons }
}

export interface PreferenceRow {
  teacherId: string
  gender: 'F' | 'M' | null
  maxKm: number | null
  finishBy: string | null
  noSession: Session | null
}

const headerIndex = (header: string[], ...names: string[]) =>
  header.findIndex((h) => names.includes(h.trim().toUpperCase()))

/** Tab nguyện vọng: MÃ GV | GIỚI TÍNH | KM TỐI ĐA | KẾT THÚC TRƯỚC | KHÔNG NHẬN BUỔI */
export function parsePreferencesGrid(grid: string[][]): PreferenceRow[] {
  const h = grid[0] ?? []
  const [iId, iG, iK, iF, iN] = [headerIndex(h, 'MÃ GV'), headerIndex(h, 'GIỚI TÍNH'), headerIndex(h, 'KM TỐI ĐA'), headerIndex(h, 'KẾT THÚC TRƯỚC'), headerIndex(h, 'KHÔNG NHẬN BUỔI')]
  if (iId < 0) return []
  return grid.slice(1).flatMap((r) => {
    const teacherId = cleanCell(r[iId])
    if (!teacherId) return []
    const g = cleanCell(r[iG])?.toLowerCase()
    const km = Number(cleanCell(r[iK]))
    const n = cleanCell(r[iN])?.toLowerCase()
    return [{
      teacherId,
      gender: g === 'nữ' ? 'F' as const : g === 'nam' ? 'M' as const : null,
      maxKm: Number.isFinite(km) && km > 0 ? km : null,
      finishBy: fmtTime(cleanCell(r[iF])),
      noSession: n === 'sáng' ? 'AM' as const : n === 'chiều' ? 'PM' as const : null,
    }]
  })
}

/** Tab Refer: TRƯỜNG | MÃ GV */
export function parseReferGrid(grid: string[][]): { school: string; teacherId: string }[] {
  const h = grid[0] ?? []
  const [iS, iT] = [headerIndex(h, 'TRƯỜNG'), headerIndex(h, 'MÃ GV')]
  if (iS < 0 || iT < 0) return []
  return grid.slice(1).flatMap((r) => {
    const school = cleanCell(r[iS])
    const teacherId = cleanCell(r[iT])
    return school && teacherId ? [{ school, teacherId }] : []
  })
}
