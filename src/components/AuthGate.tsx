import { LoaderCircle, LogIn } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, API_MODE, ApiError, type ApiUser } from '../sync/api'
import { hydrate, schedule, useSync } from '../sync/engine'
import { Button } from './ui'

type Gate = { kind: 'checking' } | { kind: 'login' } | { kind: 'loading' } | { kind: 'empty' } | { kind: 'ready' } | { kind: 'error'; message: string }

/** Có server: kiểm tra đăng nhập và nạp dữ liệu trước khi hiện app. Bản demo đi thẳng vào app. */
export function AuthGate({ children }: { children: ReactNode }) {
  return API_MODE ? <Gated>{children}</Gated> : <>{children}</>
}

function Gated({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' })
  const user = useSync((s) => s.user)

  const load = async (u: ApiUser) => {
    setGate({ kind: 'loading' })
    try {
      setGate((await hydrate(u)) ? { kind: 'ready' } : { kind: 'empty' })
    } catch (e) {
      setGate(e instanceof ApiError && e.status === 401 ? { kind: 'login' } : { kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  useEffect(() => {
    api<{ user: ApiUser }>('/auth/me')
      .then((r) => load(r.user))
      .catch((e) => setGate(e instanceof ApiError && e.status === 401 ? { kind: 'login' } : { kind: 'error', message: e.message }))
  }, [])

  // Đang dùng mà phiên hết hạn: đăng nhập lại rồi tiếp tục gửi phần chưa lưu, không nạp lại để khỏi mất thay đổi.
  if (gate.kind === 'ready' && !user) return <Login onDone={(u) => { useSync.setState({ user: u }); schedule(0) }} relogin />
  if (gate.kind === 'ready') return <>{children}</>
  if (gate.kind === 'login') return <Login onDone={load} />
  return (
    <Center>
      {gate.kind === 'error' ? (
        <div className="space-y-3 text-center">
          <p className="font-medium text-red-700">{gate.message}</p>
          <Button onClick={() => location.reload()}>Thử lại</Button>
        </div>
      ) : gate.kind === 'empty' ? (
        <p className="max-w-sm text-center text-slate-600">Database chưa có dữ liệu. Người quản trị cần chạy <code>npm run seed</code> trong thư mục <code>server</code>.</p>
      ) : (
        <p className="flex items-center gap-2 text-slate-500"><LoaderCircle size={16} className="animate-spin" />Đang tải dữ liệu…</p>
      )}
    </Center>
  )
}

function Login({ onDone, relogin = false }: { onDone: (u: ApiUser) => void; relogin?: boolean }) {
  const [email, setEmail] = useState(useSync.getState().user?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onDone((await api<{ user: ApiUser }>('/auth/login', { body: { email, password } })).user)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Center>
      <form onSubmit={submit} className="w-[340px] space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm" data-testid="login-form">
        <div>
          <div className="text-[15px] font-semibold tracking-tight text-emerald-800">Gaia</div>
          <div className="text-xs text-slate-500">{relogin ? 'Phiên đăng nhập đã hết hạn. Thay đổi chưa lưu vẫn được giữ.' : 'Điều phối lịch dạy · Vũng Tàu'}</div>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600">Email</span>
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full" autoFocus />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600">Mật khẩu</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full" />
        </label>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy} className="w-full justify-center"><LogIn size={14} />Đăng nhập</Button>
      </form>
    </Center>
  )
}

const Center = ({ children }: { children: ReactNode }) => <div className="flex h-full items-center justify-center bg-slate-50 p-6">{children}</div>
