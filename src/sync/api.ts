/** Gốc của API, đặt trong .env. Mặc định /api: cùng domain với app, qua proxy của Vite (dev) hoặc rewrite của Vercel. */
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) || '/api').replace(/\/$/, '')

export interface ApiUser {
  id: number
  email: string
  name: string
  role: 'admin' | 'editor'
}

/** Giống server/src/store.ts. */
export interface Entity {
  c: string
  id: string
  data: unknown
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown = null) {
    super(message)
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
      credentials: 'include',
      headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? `Máy chủ trả lỗi ${res.status}`, body)
  return body as T
}
