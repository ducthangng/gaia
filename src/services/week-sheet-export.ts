import type { Borders, Cell, Worksheet } from 'exceljs'
import type { WeekContext } from '../domain/context'
import { parseDate } from '../domain/time'
import { tierAmount } from '../domain/route'
import type { Tier } from '../domain/types'
import { BLOCK_ROWS, buildWeekSheet, colName, creditsAt, CTP_OFFSETS, FILLS, FIRST_BLOCK_ROW, FIRST_DAY_COL, TRACK_ROWS, type SheetBlock, type SheetCell, type WeekSheet } from '../domain/week-sheet'

const FONT = 'Times New Roman'
const LAST_DAY_COL = FIRST_DAY_COL + 84 - 1
const TOTAL_COL = LAST_DAY_COL + 1 // CL
const COST_NF = '#,##0\\ [$đ-42A]'
const DAY_FILLS = ['FFFFE599', 'FFFF9900', 'FFB4A7D6', 'FFFCE5CD', 'FFF4B083', 'FFD9D2E9', 'FFC8C8C8']
const TRACK_LABELS = ['TRƯỜNG', 'CÔNG TY', 'LỚP', 'MÔN', 'BẮT ĐẦU', 'KẾT THÚC', 'GHI CHÚ', 'QĐ. TRƯỜNG']
const TOTALS = ['TTKNS', 'TTSTEM', 'TTCDS', 'CTP', 'BC chuyên đề\n(BCCĐ)', 'Hoạt náo\n(HN)', 'Điều phối\n(ĐP)', 'Kịch\n(KI)', 'Hỗ trợ\n(HT)', 'BC tập huấn\n(BCTH)']
const COUNT_CODES = ['BCCĐ', 'HN', 'ĐP', 'KI', 'HT', 'BCTH']

type Side = 'thin' | 'medium'
const box = (left: Side | null, right: Side | null, top: Side | null, bottom: Side | null): Partial<Borders> => {
  const s = (v: Side | null) => (v ? { style: v } : undefined)
  return { left: s(left), right: s(right), top: s(top), bottom: s(bottom) } as Partial<Borders>
}
const ALL_MEDIUM = box('medium', 'medium', 'medium', 'medium')

function style(c: Cell, o: { bold?: boolean; size?: number; color?: string; fill?: string | null; nf?: string; border?: Partial<Borders>; wrap?: boolean }) {
  c.font = { name: FONT, size: o.size ?? 10, bold: !!o.bold, color: { argb: o.color ?? 'FF000000' } }
  c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: o.wrap ?? true }
  if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } }
  c.numFmt = o.nf ?? '@'
  if (o.border) c.border = o.border
}

/** Công thức THÀNH TIỀN của sheet gốc, sinh từ biểu giá đang cấu hình. */
function tierFormula(start: string, km: string, home: Tier[], other: Tier[]) {
  const chain = (tiers: Tier[]): string => {
    const [t, ...rest] = tiers
    return t.below === null || !rest.length ? String(t.amount) : `IF(${km}<${t.below},${t.amount},${chain(rest)})`
  }
  return `IF(${start}="N",${chain(home)},IF(OR(${start}="V",${start}="K"),${chain(other)},""))`
}

const knsFormula = (a: string, b: string) => `IF(OR(${a}="K",${b}="K"),1,IF(OR(${a}="K/2",${b}="K/2"),0.5,IF(${b}="BCCĐ",3,IF(${b}="ĐP",3,IF(${b}="HN",2,IF(${b}="KI",2,IF(${b}="BN",2,IF(${b}="HT",1,IF(${b}="TQ",1,IF(${b}="CA",1,IF(${b}="BCTH",3,IF(${b}="BCTH/2",2,""))))))))))))`
const stemFormula = (a: string, b: string) => `IF(OR(${a}="S",${b}="S"),1,IF(OR(${a}="S/2",${b}="S/2"),0.5,""))`
const cdsFormula = (a: string, b: string) => `IF(OR(${a}="C",${b}="C"),1,IF(OR(${a}="C/2",${b}="C/2"),0.5,IF(${a}="NB","NB",IF(OR(${a}="CM",${b}="CM"),0.001,""))))`

const FIELDS: (keyof SheetCell)[] = ['school', 'company', 'className', 'subject', 'start', 'end', 'note', 'code']

function writeHeader(ws: Worksheet, sheet: WeekSheet) {
  ws.mergeCells(1, 1, 2, 5)
  ws.getCell(1, 1).value = sheet.title
  style(ws.getCell(1, 1), { bold: true, size: 15, color: 'FFFFFFFF', fill: 'FF0000FF', border: ALL_MEDIUM })
  sheet.dates.forEach((d, i) => {
    const c0 = FIRST_DAY_COL + i * 12
    ws.mergeCells(1, c0, 1, c0 + 11)
    const head = ws.getCell(1, c0)
    head.value = parseDate(d)
    style(head, { bold: true, size: 15, fill: DAY_FILLS[i], nf: 'DDDD" - "dd/mm/yyyy', border: ALL_MEDIUM })
    ws.mergeCells(2, c0, 2, c0 + 5)
    ws.mergeCells(2, c0 + 6, 2, c0 + 11)
    ws.getCell(2, c0).value = 'SÁNG'
    ws.getCell(2, c0 + 6).value = 'CHIỀU'
    style(ws.getCell(2, c0), { bold: true, size: 15, fill: 'FFD9EAD3', border: ALL_MEDIUM })
    style(ws.getCell(2, c0 + 6), { bold: true, size: 15, fill: 'FFA8D08D', border: ALL_MEDIUM })
    for (let k = 0; k < 12; k++) {
      const c = ws.getCell(3, c0 + k)
      c.value = `TIẾT ${(k % 6) + 1}`
      style(c, { bold: true, fill: 'FF9CC2E5', border: ALL_MEDIUM })
    }
  })
  ;['MÃ GV', 'HỌ TÊN', 'QUẬN', 'Đ. CHỈ', 'TIẾT'].forEach((label, i) => {
    const c = ws.getCell(3, i + 1)
    c.value = label
    style(c, { bold: true, fill: 'FFF7CAAC', border: ALL_MEDIUM })
  })
}

function writeBlock(ws: Worksheet, b: SheetBlock, top: number, sheet: WeekSheet, ctx: WeekContext) {
  const rowOf = { kns: top + CTP_OFFSETS.kns, stem: top + CTP_OFFSETS.stem, cds: top + CTP_OFFSETS.cds, start: top + CTP_OFFSETS.start, km: top + CTP_OFFSETS.km, cost: top + CTP_OFFSETS.cost }
  const edge = (r: number): [Side | null, Side | null] => [r === top ? 'medium' : 'thin', r === top + BLOCK_ROWS - 1 ? 'medium' : 'thin']
  // Năm cột bên trái
  const labels = [...TRACK_LABELS, ...TRACK_LABELS, 'TIẾT KNS', 'TIẾT STEM', 'TIẾT CDS/AI', 'XUẤT PHÁT', 'SỐ KM', 'THÀNH TIỀN']
  const labelFill = (k: number) => (k < 8 ? null : k < 16 ? 'FFB6D7A8' : [ 'FFFFFFFF', 'FFFFFF00', 'FF00FFFF', 'FFDD7E6B', 'FFA4C2F4', 'FF00FF00' ][k - 16])
  for (let k = 0; k < BLOCK_ROWS; k++) {
    const r = top + k
    const [t, bottom] = edge(r)
    for (const col of [1, 2, 3, 4, 5]) style(ws.getCell(r, col), { border: box('medium', 'medium', t, bottom) })
    const lab = ws.getCell(r, 5)
    lab.value = labels[k]
    style(lab, { bold: true, fill: labelFill(k), border: box('medium', 'medium', t, bottom), nf: k === 21 ? COST_NF : k >= 16 ? '0.00' : '@' })
  }
  const put = (r: number, col: number, v: string | null, bold = false, fill: string | null = null) => {
    const c = ws.getCell(r, col)
    c.value = v
    const [t, bottom] = edge(r)
    style(c, { bold, fill, border: box('medium', 'medium', t, bottom) })
  }
  put(top, 1, b.id, true)
  put(top, 2, b.name, true)
  put(top + 1, 2, b.phone)
  put(top + 2, 2, b.role)
  put(top, 3, b.district, true)
  put(top, 4, b.address, true)
  put(top + 1, 4, b.office, true, b.office ? 'FF00FF00' : null)
  ws.mergeCells(top + TRACK_ROWS, 4, top + TRACK_ROWS + 7, 4)
  put(top + TRACK_ROWS, 4, 'Dạy bù, \ndạy thay,\nhỗ trợ, \nchuyên đề', true, 'FFB6D7A8')
  const idFormula = (f: string, result: string, offset: number, nf: string) => {
    const c = ws.getCell(top + offset, 4)
    c.value = { formula: f, result }
    const [t, bottom] = edge(top + offset)
    style(c, { bold: true, fill: 'FFFFFFFF', nf, border: box('medium', 'medium', t, bottom) })
  }
  idFormula(`"TT"&A${top}&"K"`, `TT${b.id}K`, CTP_OFFSETS.kns, '0.00')
  idFormula(`"TT"&A${top}&"S"`, `TT${b.id}S`, CTP_OFFSETS.stem, '0.00')
  idFormula(`"TT"&A${top}&"C"`, `TT${b.id}C`, CTP_OFFSETS.cds, '0.00')
  idFormula(`"CTP"&A${top}`, `CTP${b.id}`, CTP_OFFSETS.cost, COST_NF)

  const legAt = new Map(b.legs.map((l) => [l.col, l]))
  const totals = { kns: 0, stem: 0, cds: 0, cost: 0 }
  const counts = new Map<string, number>()
  const tiers = { home: ctx.settings.tiersFromHome, other: ctx.settings.tiersFromOther }
  for (let c = FIRST_DAY_COL; c <= LAST_DAY_COL; c++) {
    const k = (c - FIRST_DAY_COL) % 6
    const left: Side = k === 0 ? 'medium' : 'thin'
    const right: Side = k === 5 ? 'medium' : 'thin'
    const L = colName(c)
    for (const track of [0, 1]) {
      const cell = b.cells.get(`${track}|${c}`)
      FIELDS.forEach((field, i) => {
        const r = top + track * TRACK_ROWS + i
        const x = ws.getCell(r, c)
        x.value = cell?.[field] ?? null
        const [t, bottom] = edge(r)
        style(x, { size: i === 0 ? 11 : 10, color: cell?.whiteText ? 'FFFFFFFF' : 'FF000000', fill: cell?.fill ?? (track === 1 ? 'FFB6D7A8' : null), border: box(left, right, t, bottom) })
      })
    }
    const code0 = b.cells.get(`0|${c}`)?.code ?? null
    const code1 = b.cells.get(`1|${c}`)?.code ?? null
    if (code1) counts.set(code1, (counts.get(code1) ?? 0) + 1)
    const credit = creditsAt(code0, code1)
    const a = `${L}${top + 7}`
    const q = `${L}${top + 15}`
    const put2 = (row: number, formula: string, result: number | string, fill: string, nf = '@') => {
      const x = ws.getCell(row, c)
      x.value = { formula, result: result as number }
      const [t, bottom] = edge(row)
      style(x, { fill, nf, border: box(left, right, t, bottom) })
    }
    put2(rowOf.kns, knsFormula(a, q), credit.kns, 'FFFFFFFF')
    put2(rowOf.stem, stemFormula(a, q), credit.stem, 'FFFFFF00')
    put2(rowOf.cds, cdsFormula(a, q), credit.cds, 'FF00FFFF')
    // Tuần vắt qua hai tháng: công thức tổng chỉ cộng từ ngày đầu tháng mới, số lưu sẵn phải khớp với nó.
    if (c >= sheet.costFromCol) {
      if (typeof credit.kns === 'number') totals.kns += credit.kns
      if (typeof credit.stem === 'number') totals.stem += credit.stem
      if (typeof credit.cds === 'number') totals.cds += credit.cds
    }

    const leg = legAt.get(c)
    const startCell = ws.getCell(rowOf.start, c)
    startCell.value = leg?.start ?? null
    style(startCell, { fill: 'FFDD7E6B', nf: '0.00', border: box(left, right, 'thin', 'thin') })
    const kmCell = ws.getCell(rowOf.km, c)
    kmCell.value = leg?.km ?? null
    style(kmCell, { fill: (c - FIRST_DAY_COL) % 6 < 3 ? 'FFA4C2F4' : 'FF9FC5E8', nf: '0.00', border: box(left, right, 'thin', 'thin') })
    const amount = leg ? (leg.start === 'N' ? tierAmount(tiers.home, leg.km) : tierAmount(tiers.other, leg.km)) : ''
    // Giữ đúng số đã chốt của tuần lưu trữ khi ô đó từng được sửa tay.
    put2(rowOf.cost, tierFormula(`${L}${rowOf.start}`, `${L}${rowOf.km}`, tiers.home, tiers.other), leg ? (ctx.week.status === 'archived' ? leg.cost : amount) : '', 'FF00FF00', COST_NF)
    if (leg && c >= sheet.costFromCol) totals.cost += ctx.week.status === 'archived' ? leg.cost : (amount as number)
  }

  // Cột tổng, đặt ở dòng TIẾT KNS của khối như sheet gốc.
  const from = colName(sheet.costFromCol)
  const to = colName(LAST_DAY_COL)
  const r = rowOf.kns
  const q = top + 15
  const total = (i: number, formula: string, result: number, nf: string) => {
    const c = ws.getCell(r, TOTAL_COL + i)
    c.value = { formula, result }
    style(c, { nf, wrap: false, border: i === 0 ? box('medium', null, null, null) : undefined })
  }
  total(0, `SUM($${from}${rowOf.kns}:$${to}${rowOf.kns})`, totals.kns, '0.0')
  total(1, `SUM($${from}${rowOf.stem}:$${to}${rowOf.stem})`, totals.stem, '0.0')
  total(2, `SUM($${from}${rowOf.cds}:$${to}${rowOf.cds})`, totals.cds, '0.0')
  total(3, `SUM($${from}${rowOf.cost}:$${to}${rowOf.cost})`, totals.cost, COST_NF)
  COUNT_CODES.forEach((code, i) => total(4 + i, `COUNTIF($F${q}:$${to}${q},"${code}")`, counts.get(code) ?? 0, '0.00'))
  const sum = ws.getCell(r, TOTAL_COL + 11)
  sum.value = { formula: `SUM(${colName(TOTAL_COL)}${r}:${colName(TOTAL_COL + 2)}${r})`, result: totals.kns + totals.stem + totals.cds }
  style(sum, { nf: '0.0' })
  return totals
}

function writeLegend(ws: Worksheet, top: number) {
  const thin = box('thin', 'thin', 'thin', 'thin')
  const head = (r: number, text: string, toCol: number) => {
    ws.mergeCells(r, 1, r, toCol)
    const c = ws.getCell(r, 1)
    c.value = text
    style(c, { bold: true, color: 'FF980000', border: thin })
  }
  const line = (r: number, a: string, b: string, text: string, toCol: number) => {
    ws.getCell(r, 1).value = a
    ws.getCell(r, 2).value = b
    style(ws.getCell(r, 1), { border: thin })
    style(ws.getCell(r, 2), { border: thin })
    ws.mergeCells(r, 3, r, toCol)
    ws.getCell(r, 3).value = text
    style(ws.getCell(r, 3), { border: thin })
  }
  head(top, 'Tiết dạy quy đổi', 5)
  ;[['K', '1 tiết', 'Dạy chính KNS'], ['S', '1 tiết', 'Dạy chính STEM'], ['C', '1 tiết', 'Dạy chính CDS'], ['K/2', '0,5 tiết', 'HT teambuilding ngoài trời KNS'], ['S/2', '0,5 tiết', 'HT teambuilding ngoài trời STEM'], ['C/2', '0,5 tiết', 'HT teambuilding ngoài trời CDS'], ['CM', '0 tiết', 'Học CM, trợ giảng, hỗ trợ KNS, STEM, CDS']]
    .forEach(([a, b, t], i) => line(top + 1 + i, a, b, t, 5))
  const r2 = top + 10
  head(r2, 'Tiết chuyên đề quy đổi', 4)
  ;[['BCTH', '3 tiết', 'Báo cáo tập huấn'], ['BCCĐ', '3 tiết', 'Báo cáo chuyên đề'], ['ĐP', '3 tiết', 'Điều phối'], ['HN', '2 tiết', 'Hoạt náo'], ['KI', '2 tiết', 'Kịch, múa, nhảy'], ['BN', '2 tiết', 'Bấm nhạc'], ['HT', '1 tiết', 'Hỗ trợ chung'], ['TQ', '1 tiết', 'Tặng quà'], ['CA', '1 tiết', 'Chụp ảnh']]
    .forEach(([a, b, t], i) => line(r2 + 1 + i, a, b, t, 4))
  const r3 = top + 22
  ws.getCell(r3, 1).value = 'Màu sắc'
  style(ws.getCell(r3, 1), { bold: true, color: 'FF980000', border: thin })
  ws.mergeCells(r3, 2, r3, 4)
  ws.getCell(r3, 2).value = 'Quy định'
  style(ws.getCell(r3, 2), { bold: true, color: 'FF980000', border: thin })
  const colors: [string, string | null, string, boolean?][] = [
    ['Chữ đen', null, 'Lịch dạy Kỹ năng sống'], ['Chữ đen', FILLS.stem, 'Lịch dạy STEM'], ['Chữ đen', FILLS.cds, 'Lịch dạy Công dân số / AI'],
    ['Chữ trắng', FILLS.subKns, 'Lịch dạy thay Kỹ năng sống', true], ['Chữ trắng', FILLS.subStem, 'Lịch dạy thay STEM', true], ['Chữ trắng', FILLS.subCds, 'Lịch dạy thay Công dân số / AI', true],
    ['Chữ đen', FILLS.makeupKns, 'Lịch dạy bù  Kỹ năng sống'], ['Chữ đen', FILLS.makeupStem, 'Lịch dạy bù STEM'], ['Chữ đen', FILLS.makeupCds, 'Lịch dạy bù Công dân số / AI'],
    ['Chữ đen', FILLS.support, 'Dự thính, trợ giảng, hỗ trợ, học CM'], ['Chữ đen', FILLS.leave, 'GV xin nghỉ phép'], ['Chữ đen', FILLS.event, 'Chuyên đề, tập huấn, hội thảo, demo'],
    ['Chữ đen', FILLS.schoolOff, 'Trường báo nghỉ'], ['Chữ đen', FILLS.observe, 'Dự giờ (Nhóm trưởng và chuyên viên dự)'],
  ]
  colors.forEach(([a, fill, text, white], i) => {
    const r = r3 + 1 + i
    ws.getCell(r, 1).value = a
    style(ws.getCell(r, 1), { bold: true, fill, color: white ? 'FFFFFFFF' : 'FF000000', border: thin })
    ws.mergeCells(r, 2, r, 4)
    ws.getCell(r, 2).value = text
    style(ws.getCell(r, 2), { border: thin })
  })
  const r4 = r3 + 17
  ws.mergeCells(r4, 1, r4 + 2, 1)
  ws.getCell(r4, 1).value = 'ĐIỂM XUẤT PHÁT'
  style(ws.getCell(r4, 1), { bold: true, fill: 'FFDD7E6B', border: thin })
  ;['N : Nhà', 'V : Văn phòng công ty', 'K : Địa điểm khác'].forEach((t, i) => {
    ws.mergeCells(r4 + i, 2, r4 + i, 3)
    ws.getCell(r4 + i, 2).value = t
    style(ws.getCell(r4 + i, 2), { fill: 'FFFFFFFF', border: thin })
  })
}

/** Dựng file Excel đúng bố cục sheet tuần của Gaia; trả về số ca không xếp được để báo cho người dùng. */
export async function buildWeekWorkbook(ctx: WeekContext) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const sheet = buildWeekSheet(ctx)
  const ws = wb.addWorksheet(sheet.sheetName, { views: [{ state: 'frozen', xSplit: 5, ySplit: 3 }], properties: { defaultColWidth: 12.63, defaultRowHeight: 15.75 } })
  writeHeader(ws, sheet)
  TOTALS.forEach((label, i) => {
    const col = TOTAL_COL + i
    ws.mergeCells(1, col, 2, col)
    const c = ws.getCell(1, col)
    c.value = label
    style(c, { bold: true, fill: 'FF9CC2E5', nf: i < 3 ? '0.0' : i === 3 ? COST_NF : '@', border: ALL_MEDIUM })
  })
  const totals = sheet.blocks.map((b, n) => writeBlock(ws, b, FIRST_BLOCK_ROW + n * BLOCK_ROWS, sheet, ctx))
  const lastRow = FIRST_BLOCK_ROW + sheet.blocks.length * BLOCK_ROWS - 1
  ;[
    totals.reduce((s, t) => s + t.kns, 0), totals.reduce((s, t) => s + t.stem, 0), totals.reduce((s, t) => s + t.cds, 0), totals.reduce((s, t) => s + t.cost, 0),
  ].forEach((result, i) => {
    const L = colName(TOTAL_COL + i)
    const c = ws.getCell(3, TOTAL_COL + i)
    c.value = { formula: `SUM(${L}4:${L}${lastRow})`, result }
    style(c, { nf: i === 3 ? COST_NF : '0.0', border: ALL_MEDIUM })
  })
  COUNT_CODES.forEach((_, i) => {
    const L = colName(TOTAL_COL + 4 + i)
    const c = ws.getCell(3, TOTAL_COL + 4 + i)
    c.value = { formula: `SUM(${L}4:${L}${lastRow})`, result: 0 }
    style(c, { nf: '0.00', border: ALL_MEDIUM })
    ws.getColumn(TOTAL_COL + 4 + i).hidden = true
  })
  writeLegend(ws, lastRow + 6)

  // Danh sách thả xuống như sheet gốc, cần sheet Danh Sách Trường đi kèm.
  const list = wb.addWorksheet('Danh Sách Trường')
  list.getRow(1).values = ['STT', 'TÊN', 'KHU VỰC', 'TRƯỜNG', 'ĐỊA CHỈ']
  list.getRow(1).font = { name: FONT, bold: true }
  const schools = [...ctx.world.schools].sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'))
  schools.forEach((s, i) => { list.getRow(i + 2).values = [i + 1, s.name, s.region, s.fullName, s.address] })
  list.getColumn(4).width = 42
  list.getColumn(5).width = 60
  const q = `'Danh Sách Trường'!`
  const schoolRange = `${q}$D$2:$D$${schools.length + 1}`
  const company = '"NEWG,GAIA"'
  const subject = '"KNS,STEM,CDS,AI,STEM-AI,STEM AI - ROBOTICS"'
  const dv = (formulae: string[]) => ({ type: 'list' as const, allowBlank: true, showErrorMessage: false, formulae })
  sheet.blocks.forEach((_, n) => {
    const top = FIRST_BLOCK_ROW + n * BLOCK_ROWS
    for (let c = FIRST_DAY_COL; c <= LAST_DAY_COL; c++) {
      for (const track of [0, 1]) {
        const base = top + track * TRACK_ROWS
        ws.getCell(base, c).dataValidation = dv([schoolRange])
        ws.getCell(base + 1, c).dataValidation = dv([company])
        ws.getCell(base + 3, c).dataValidation = dv([subject])
      }
    }
  })
  return { wb, sheet }
}

