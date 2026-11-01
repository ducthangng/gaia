import type { WeekContext } from './context'
import { byTime, routeForWeek } from './route'
import { dayIndex, parseDate, shortDate, weekDates } from './time'
import type { Lesson, Session, Teacher, Week } from './types'

/** Bố cục sheet tuần của Gaia: mỗi giáo viên 22 dòng, mỗi ngày 12 cột (6 tiết sáng + 6 tiết chiều). */
export const BLOCK_ROWS = 22
export const FIRST_BLOCK_ROW = 4
export const FIRST_DAY_COL = 6
export const TRACK_ROWS = 8
export const CTP_OFFSETS = { kns: 16, stem: 17, cds: 18, start: 19, km: 20, cost: 21 } as const

export const FILLS = {
  stem: 'FFFFFF00', cds: 'FF76A5AF',
  subKns: 'FF000000', subStem: 'FF980000', subCds: 'FF4A86E8',
  makeupKns: 'FF8E7CC3', makeupStem: 'FFF6B26B', makeupCds: 'FF3D85C6',
  support: 'FFF6A4F6', leave: 'FFFF0000', event: 'FF00FF00', schoolOff: 'FF999999', observe: 'FFCC4125',
}
const WHITE_TEXT = new Set([FILLS.subKns, FILLS.subStem, FILLS.subCds])

export interface SheetCell {
  school: string | null
  company: string | null
  className: string | null
  subject: string | null
  start: string | null
  end: string | null
  note: string | null
  code: string | null
  fill: string | null
  whiteText: boolean
}

export interface SheetLeg {
  col: number
  start: string
  km: number
  cost: number
}

export interface SheetBlock {
  id: string
  name: string
  phone: string | null
  role: string | null
  district: string | null
  address: string | null
  office: string | null
  /** khoá `${track}|${cột}` */
  cells: Map<string, SheetCell>
  legs: SheetLeg[]
}

export interface WeekSheet {
  sheetName: string
  title: string
  dates: string[]
  blocks: SheetBlock[]
  /** Ca không xếp được vào ô nào; phải báo cho người dùng, không được âm thầm bỏ. */
  unplaced: Lesson[]
  /** Cột đầu tiên được cộng vào CTP: tuần vắt qua hai tháng chỉ cộng từ ngày đầu tháng mới. */
  costFromCol: number
}

const family = (subject: string | null): 'kns' | 'stem' | 'cds' => {
  const s = subject ?? ''
  if (s.includes('KNS')) return 'kns'
  return s === 'STEM' || s.includes('ROBOTICS') ? 'stem' : s ? 'cds' : 'kns'
}

/** Màu theo đúng bảng "Màu sắc - Quy định" cuối sheet gốc. */
export function lessonFill(l: Lesson): string | null {
  if (l.status === 'school_off') return FILLS.schoolOff
  if (l.status === 'needs_cover' || l.status === 'replaced' || l.status === 'cancelled') return FILLS.leave
  const f = family(l.subject)
  if (l.type === 'substitute') return f === 'kns' ? FILLS.subKns : f === 'stem' ? FILLS.subStem : FILLS.subCds
  if (l.type === 'makeup') return f === 'kns' ? FILLS.makeupKns : f === 'stem' ? FILLS.makeupStem : FILLS.makeupCds
  if (l.type === 'support') return FILLS.support
  if (l.type === 'event') return FILLS.event
  if (l.type === 'observe') return FILLS.observe
  return f === 'kns' ? null : f === 'stem' ? FILLS.stem : FILLS.cds
}

const hhmm = (t: string | null) => (t ? t.replace(':', 'h') : null)

/** Tên sheet theo cách Gaia đang đặt: tháng và số tuần lấy theo ngày Thứ Năm của tuần. */
export function weekSheetName(monday: string) {
  const thursday = parseDate(monday)
  thursday.setUTCDate(thursday.getUTCDate() + 3)
  return `Thang ${thursday.getUTCMonth() + 1} - Tuan ${Math.floor((thursday.getUTCDate() - 1) / 7) + 1}`
}

export const dayCol = (dayIdx: number, session: Session, period: number) => FIRST_DAY_COL + dayIdx * 12 + (session === 'AM' ? 0 : 6) + period - 1

const NO_TEACHER_ID = 'CHUA-XEP'

export function buildWeekSheet(ctx: WeekContext): WeekSheet {
  const week: Week = ctx.week
  const dates = weekDates(week.startDate)
  const office = (t: Teacher) => ctx.officeName(t.officeId).replace(/^VP\s+/, 'VP. ')
  const owners = new Set<string>()
  for (const l of week.lessons) {
    const id = l.teacherId ?? l.originalTeacherId
    if (id) owners.add(id)
  }
  // Tuần đã chốt liệt kê đúng những người có trong tuần đó, không phải danh sách giáo viên hiện tại.
  const listed = week.status === 'archived' && week.reported ? new Set(Object.keys(week.reported)) : null
  const teachers = ctx.world.teachers
    .filter((t) => (listed ? listed.has(t.id) : t.active) || owners.has(t.id) || week.legs.some((x) => x.teacherId === t.id))
    .sort((a, b) => a.id.localeCompare(b.id))

  const toCell = (l: Lesson): SheetCell => {
    const fill = lessonFill(l)
    return {
      school: ctx.schoolById.get(l.schoolId)?.fullName ?? l.schoolId,
      company: l.company,
      className: l.className,
      subject: l.subject,
      start: hhmm(l.start),
      end: hhmm(l.end),
      note: l.note ?? (l.status === 'needs_cover' || l.status === 'cancelled' ? 'NP' : null),
      // Mã quy đổi chỉ tính khi ca thật sự diễn ra, giống sheet gốc.
      code: l.status === 'assigned' ? l.code : null,
      fill,
      whiteText: fill !== null && WHITE_TEXT.has(fill),
    }
  }

  const unplaced: Lesson[] = []
  const place = (cells: Map<string, SheetCell>, l: Lesson) => {
    const d = dayIndex(l.date)
    const tracks = l.track === 1 ? [1, 0] : l.type === 'regular' ? [0, 1] : [1, 0]
    // Giữ đúng tiết gốc nếu còn trống; ca đã sửa giờ có thể phải sang tiết khác cùng buổi.
    const periods = [l.period, 1, 2, 3, 4, 5, 6].filter((p, i, a) => a.indexOf(p) === i)
    for (const track of tracks) {
      for (const p of periods) {
        const col = dayCol(d, l.session, p)
        const key = `${track}|${col}`
        if (!cells.has(key)) {
          cells.set(key, toCell(l))
          return col
        }
      }
    }
    unplaced.push(l)
    return null
  }

  const blocks: SheetBlock[] = teachers.map((t) => {
    const cells = new Map<string, SheetCell>()
    const placedAt = new Map<string, number>()
    const mine = week.lessons.filter((l) => (l.teacherId ?? l.originalTeacherId) === t.id || (l.originalTeacherId === t.id && l.status !== 'assigned'))
    // Giữ ca có sẵn tiết gốc trước, để ca sửa giờ không chiếm mất chỗ của chúng.
    for (const l of [...mine].sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))) {
      const col = place(cells, l)
      if (col !== null && l.teacherId === t.id) {
        const key = `${l.date}|${l.session}|${l.schoolId}`
        if (!placedAt.has(key)) placedAt.set(key, col)
        placedAt.set(`${l.date}|${l.session}|${l.period}`, col)
      }
    }
    // Ngày nghỉ không gắn với ca nào vẫn phải hiện đỏ, giống cách Gaia đang ghi.
    for (const lv of ctx.world.leaves) {
      if (lv.teacherId !== t.id || lv.lessonId || !dates.includes(lv.date)) continue
      const d = dayIndex(lv.date)
      // Làm online chỉ ghi một ô ở dòng chuyên đề; nghỉ phép tô đỏ cả buổi như sheet gốc, ghi chú ở ô đầu.
      const track = lv.kind === 'online' ? 1 : 0
      const fill = lv.kind === 'online' ? FILLS.event : FILLS.leave
      let noted = false
      for (const p of [1, 2, 3, 4, 5, 6]) {
        const key = `${track}|${dayCol(d, lv.session, p)}`
        if (cells.has(key)) continue
        cells.set(key, { school: null, company: null, className: null, subject: null, start: null, end: null, note: noted ? null : lv.note, code: null, fill, whiteText: false })
        noted = true
        if (lv.kind === 'online') break
      }
    }
    const legs: SheetLeg[] = []
    const used = new Set<number>()
    for (const date of dates) {
      for (const leg of routeForWeek(week, t, date, ctx).legs) {
        const d = dayIndex(date)
        const col = placedAt.get(`${date}|${leg.session}|${leg.period}`) ?? placedAt.get(`${date}|${leg.session}|${leg.toSchoolId}`) ?? dayCol(d, leg.session, leg.period)
        const free = used.has(col) ? [1, 2, 3, 4, 5, 6].map((p) => dayCol(d, leg.session, p)).find((c) => !used.has(c)) ?? col : col
        used.add(free)
        legs.push({ col: free, start: leg.start, km: leg.km, cost: leg.cost })
      }
    }
    return {
      id: t.id, name: t.name, phone: t.phone, role: t.isManager ? 'QUẢN LÝ' : null, district: t.district, address: t.address, office: office(t), cells, legs,
    }
  })

  // Ca chưa từng có giáo viên không thuộc khối của ai: gom vào khối riêng để không bị mất khỏi file.
  const orphan = week.lessons.filter((l) => !l.teacherId && !l.originalTeacherId && l.status !== 'replaced').sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))
  let remaining = orphan
  for (let n = 1; remaining.length; n++) {
    const cells = new Map<string, SheetCell>()
    const before = unplaced.length
    for (const l of remaining) place(cells, l)
    const overflow = unplaced.splice(before)
    blocks.push({ id: n === 1 ? NO_TEACHER_ID : `${NO_TEACHER_ID}-${n}`, name: 'CHƯA CÓ GIÁO VIÊN', phone: null, role: null, district: null, address: null, office: null, cells, legs: [] })
    remaining = overflow
  }

  const fromDate = week.reportedFrom ?? week.startDate
  return {
    sheetName: weekSheetName(week.startDate),
    title: `CẬP NHẬT TUẦN ${shortDate(week.startDate)} - ${shortDate(week.endDate)}`,
    dates,
    blocks,
    unplaced,
    costFromCol: FIRST_DAY_COL + Math.max(0, dates.indexOf(fromDate)) * 12,
  }
}

/** Kết quả ba dòng tiết quy đổi, đúng logic công thức của sheet gốc. */
export function creditsAt(code0: string | null, code1: string | null) {
  const any = (c: string) => code0 === c || code1 === c
  const eventValue: Record<string, number> = { BCCĐ: 3, ĐP: 3, HN: 2, KI: 2, BN: 2, HT: 1, TQ: 1, CA: 1, BCTH: 3, 'BCTH/2': 2 }
  const kns: number | '' = any('K') ? 1 : any('K/2') ? 0.5 : (code1 && eventValue[code1]) || ''
  const stem: number | '' = any('S') ? 1 : any('S/2') ? 0.5 : ''
  const cds: number | string = any('C') ? 1 : any('C/2') ? 0.5 : code0 === 'NB' ? 'NB' : any('CM') ? 0.001 : ''
  return { kns, stem, cds }
}

export const colName = (n: number) => {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

const OFFSET_ROWS = ['school', 'company', 'className', 'subject', 'start', 'end', 'note', 'code'] as const

/** Dạng bảng chữ của sheet, cùng toạ độ với file xuất: để kiểm tra và đọc lại được bằng bộ đọc Google Sheet. */
export function sheetToGrid(sheet: WeekSheet): string[][] {
  const rows = FIRST_BLOCK_ROW - 1 + sheet.blocks.length * BLOCK_ROWS
  const grid: string[][] = Array.from({ length: rows }, () => Array.from({ length: FIRST_DAY_COL - 1 + 84 }, () => ''))
  grid[0][0] = sheet.title
  sheet.dates.forEach((d, i) => { grid[0][FIRST_DAY_COL - 1 + i * 12] = d })
  sheet.blocks.forEach((b, n) => {
    const top = FIRST_BLOCK_ROW - 1 + n * BLOCK_ROWS
    grid[top][0] = b.id
    grid[top][1] = b.name
    grid[top + 1][1] = b.phone ?? ''
    grid[top][2] = b.district ?? ''
    grid[top][3] = b.address ?? ''
    grid[top + 1][3] = b.office ?? ''
    for (const track of [0, 1]) {
      ;['TRƯỜNG', 'CÔNG TY', 'LỚP', 'MÔN', 'BẮT ĐẦU', 'KẾT THÚC', 'GHI CHÚ', 'QĐ. TRƯỜNG'].forEach((label, k) => { grid[top + track * TRACK_ROWS + k][4] = label })
    }
    for (const [key, cell] of b.cells) {
      const [track, col] = key.split('|').map(Number)
      OFFSET_ROWS.forEach((field, k) => { grid[top + track * TRACK_ROWS + k][col - 1] = cell[field] ?? '' })
    }
  })
  return grid
}
