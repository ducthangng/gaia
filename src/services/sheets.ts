import { gvizCsvUrl, parseCsv } from '../domain/sheet-grid'

/** Đọc một tab qua endpoint gviz: không cần API key, nhưng Sheet phải chia sẻ "Bất kỳ ai có liên kết". */
export async function fetchSheetTab(sheetId: string, tab: string): Promise<string[][]> {
  let res: Response
  try {
    res = await fetch(gvizCsvUrl(sheetId, tab))
  } catch {
    throw new Error('Không kết nối được Google Sheets. Sheet cần được chia sẻ "Bất kỳ ai có liên kết đều xem được".')
  }
  if (!res.ok) throw new Error(`Google Sheets trả lỗi ${res.status}. Kiểm tra lại link và quyền chia sẻ.`)
  const text = await res.text()
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('Sheet chưa được chia sẻ công khai nên Google trả về trang đăng nhập.')
  return parseCsv(text)
}
