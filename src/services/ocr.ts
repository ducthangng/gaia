import { otsuThreshold, removeTableLines, type OcrWord } from '../domain/ocr-parse'

interface TessWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

const TARGET_WIDTH = 2400

/** Ảnh xám -> nhị phân -> phóng to -> xoá đường kẻ bảng. Chạy trên canvas nên ảnh không rời khỏi máy. */
async function preprocess(image: File | string): Promise<HTMLCanvasElement> {
  const blob = typeof image === 'string' ? await (await fetch(image)).blob() : image
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(3, Math.max(1, TARGET_WIDTH / bitmap.width))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingQuality = 'high'
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const pixels = g.getImageData(0, 0, canvas.width, canvas.height)
  const d = pixels.data
  const gray = new Uint8Array(canvas.width * canvas.height)
  for (let i = 0; i < gray.length; i++) gray[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000
  const threshold = otsuThreshold(gray)
  const ink = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i++) ink[i] = gray[i] <= threshold ? 1 : 0
  const clean = removeTableLines(ink, canvas.width, canvas.height)
  for (let i = 0; i < clean.length; i++) {
    const v = clean[i] ? 0 : 255
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
    d[i * 4 + 3] = 255
  }
  g.putImageData(pixels, 0, 0)
  return canvas
}

/**
 * OCR chạy ngay trong trình duyệt: ảnh không rời khỏi máy, chỉ tải mô hình ngôn ngữ từ CDN ở lần đầu.
 * Giai đoạn backend có thể thay bằng dịch vụ OCR khác mà không đổi màn hình duyệt.
 */
export async function recognizeImage(image: File | string, onProgress: (ratio: number, status: string) => void): Promise<OcrWord[]> {
  const { createWorker, PSM } = await import('tesseract.js')
  const canvas = await preprocess(image)
  const worker = await createWorker(['vie', 'eng'], undefined, {
    logger: (m: { status: string; progress: number }) => onProgress(m.progress, m.status),
  })
  try {
    // Chế độ chữ rời rạc: bảng lịch không có đoạn văn nên phân tích bố cục mặc định dễ gộp sai ô.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' })
    const { data } = await worker.recognize(canvas, {}, { blocks: true })
    const words: TessWord[] = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words as unknown as TessWord[])))
    return words.map((w) => ({ text: w.text, confidence: w.confidence, ...w.bbox }))
  } finally {
    await worker.terminate()
  }
}
