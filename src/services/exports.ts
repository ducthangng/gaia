import type { Workbook, Worksheet } from 'exceljs'
import { byTime } from '../domain/route'
import { dayLabel, SESSION_LABEL, weekDates } from '../domain/time'
import { teacherLabel, type Lesson } from '../domain/types'
import { weekCosts, type Ctx } from '../hooks'

const download = (buffer: ArrayBuffer, filename: string) => {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const sheetName = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)

function addTable(ws: Worksheet, title: string, header: string[], rows: (string | number | null)[][], widths: number[]) {
  ws.addRow([title]).font = { name: 'Arial', bold: true, size: 13 }
  ws.addRow([])
  const h = ws.addRow(header)
  h.eachCell((c) => {
    c.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } }
    c.alignment = { vertical: 'middle', wrapText: true }
  })
  rows.forEach((r) => {
    const row = ws.addRow(r)
    row.eachCell((c) => {
      c.font = { name: 'Arial' }
      c.border = { bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } } }
    })
  })
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  ws.views = [{ state: 'frozen', ySplit: 3 }]
}

const statusText = (l: Lesson) =>
  l.status === 'school_off' ? 'Trường báo nghỉ' : l.status === 'cancelled' ? 'Huỷ do GV nghỉ' : l.status === 'replaced' ? 'Đã có người thay' : l.status === 'needs_cover' ? 'CẦN GIÁO VIÊN' : l.type === 'substitute' ? 'Dạy thay' : l.type === 'makeup' ? 'Dạy bù' : ''

const visible = (ctx: Ctx) => ctx.week.lessons.filter((l) => l.status !== 'replaced')

const teacherRows = (ctx: Ctx, teacherId: string) =>
  visible(ctx).filter((l) => l.teacherId === teacherId).sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b)).map((l) => [
    dayLabel(l.date), SESSION_LABEL[l.session], l.start && l.end ? `${l.start}–${l.end}` : `Tiết ${l.period}`, ctx.schoolById.get(l.schoolId)?.fullName ?? '', l.className, l.subject, statusText(l),
  ])

const schoolRows = (ctx: Ctx, schoolId: string) =>
  visible(ctx).filter((l) => l.schoolId === schoolId).sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b)).map((l) => [
    dayLabel(l.date), SESSION_LABEL[l.session], l.start && l.end ? `${l.start}–${l.end}` : `Tiết ${l.period}`, l.className, l.subject, l.teacherId ? (ctx.teacherById.get(l.teacherId) ? teacherLabel(ctx.teacherById.get(l.teacherId)!) : l.teacherId) : '', statusText(l),
  ])

const newBook = async (): Promise<Workbook> => {
  const { default: ExcelJS } = await import('exceljs')
  return new ExcelJS.Workbook()
}

export async function exportTeacherSchedule(ctx: Ctx, teacherId: string) {
  const wb = await newBook()
  const t = ctx.teacherById.get(teacherId)!
  addTable(wb.addWorksheet('Lịch dạy'), `Lịch dạy ${teacherLabel(t)} · ${ctx.week.startDate} → ${ctx.week.endDate}`, ['Ngày', 'Buổi', 'Giờ', 'Trường', 'Lớp', 'Môn', 'Ghi chú'], teacherRows(ctx, teacherId), [14, 8, 14, 38, 10, 12, 18])
  download(await wb.xlsx.writeBuffer() as ArrayBuffer, `lich-${teacherId}-${ctx.week.startDate}.xlsx`)
}

export async function exportSchoolSchedule(ctx: Ctx, schoolId: string) {
  const wb = await newBook()
  const s = ctx.schoolById.get(schoolId)!
  addTable(wb.addWorksheet('Lịch trường'), `${s.fullName} · ${ctx.week.startDate} → ${ctx.week.endDate}`, ['Ngày', 'Buổi', 'Giờ', 'Lớp', 'Môn', 'Giáo viên', 'Ghi chú'], schoolRows(ctx, schoolId), [14, 8, 14, 10, 12, 30, 18])
  download(await wb.xlsx.writeBuffer() as ArrayBuffer, `lich-${s.id}-${ctx.week.startDate}.xlsx`)
}

/** Toàn bộ tuần: một sheet chi phí và một sheet cho mỗi giáo viên / trường có lịch. */
export async function exportWeek(ctx: Ctx) {
  const wb = await newBook()
  const dates = weekDates(ctx.week.startDate)
  const costs = weekCosts(ctx).filter((c) => c.km > 0 || c.cost > 0)
  addTable(
    wb.addWorksheet('Chi phí di chuyển'),
    `Chi phí di chuyển · ${ctx.week.startDate} → ${ctx.week.endDate}`,
    ['Mã GV', 'Giáo viên', ...dates.map(dayLabel), 'Tổng km', 'Tổng chi phí (đ)'],
    costs.map((c) => [c.teacherId, ctx.teacherById.get(c.teacherId)?.name ?? '', ...c.days.map((d) => d.cost || null), c.km, c.cost]),
    [10, 28, ...dates.map(() => 12), 10, 14],
  )
  const used = new Set<string>(['Chi phí di chuyển'])
  const unique = (name: string) => {
    let n = sheetName(name)
    for (let i = 2; used.has(n); i++) n = sheetName(`${name.slice(0, 27)} ${i}`)
    used.add(n)
    return n
  }
  for (const t of ctx.world.teachers) {
    const rows = teacherRows(ctx, t.id)
    if (rows.length) addTable(wb.addWorksheet(unique(t.name.includes(t.id) ? t.name : `${t.id} ${t.name}`)), `Lịch dạy ${teacherLabel(t)}`, ['Ngày', 'Buổi', 'Giờ', 'Trường', 'Lớp', 'Môn', 'Ghi chú'], rows, [14, 8, 14, 38, 10, 12, 18])
  }
  for (const s of ctx.world.schools) {
    const rows = schoolRows(ctx, s.id)
    if (rows.length) addTable(wb.addWorksheet(unique(s.fullName)), s.fullName, ['Ngày', 'Buổi', 'Giờ', 'Lớp', 'Môn', 'Giáo viên', 'Ghi chú'], rows, [14, 8, 14, 10, 12, 30, 18])
  }
  download(await wb.xlsx.writeBuffer() as ArrayBuffer, `lich-tuan-${ctx.week.startDate}.xlsx`)
}
