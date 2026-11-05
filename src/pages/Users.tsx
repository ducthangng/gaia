import { Check, Copy, KeyRound, Lock, LockOpen, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Badge, Button, Card, Empty, PageHeader, toast } from '../components/ui'
import { api } from '../sync/api'
import { useSync } from '../sync/engine'

interface UserRow {
  id: number
  email: string
  name: string
  role: 'admin' | 'editor'
  disabled: boolean
  createdAt: string
}

// Bỏ các ký tự dễ nhầm (0/O, 1/l/I) vì mật khẩu thường được đọc hoặc gõ lại từ tin nhắn.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const randomPassword = () => Array.from(crypto.getRandomValues(new Uint32Array(14)), (n) => ALPHABET[n % ALPHABET.length]).join('')

const ROLE_LABEL = { admin: 'Quản trị', editor: 'Điều phối' } as const

/** Mật khẩu chỉ hiện một lần ngay sau khi tạo hoặc đặt lại, để admin gửi cho người dùng. */
function Credential({ email, password, onDone }: { email: string; password: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const text = `Gaia: ${location.origin}\nEmail: ${email}\nMật khẩu: ${password}`
  return (
    <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-950" data-testid="credential">
      <div className="font-medium">Gửi thông tin đăng nhập này cho người dùng. Mật khẩu chỉ hiện một lần.</div>
      <pre className="whitespace-pre-wrap rounded bg-white px-3 py-2 font-mono text-sm">{text}</pre>
      <div className="flex gap-2">
        <Button onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Đã sao chép' : 'Sao chép'}</Button>
        <Button variant="ghost" onClick={onDone}>Xong</Button>
      </div>
    </div>
  )
}

export function UsersPage() {
  const me = useSync((s) => s.user)
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null)
  const load = () => api<{ users: UserRow[] }>('/users').then((r) => setUsers(r.users)).catch((e) => setError(e.message))
  useEffect(() => {
    if (me?.role === 'admin') load()
  }, [me?.role])

  if (me?.role !== 'admin') return <Empty>Chỉ tài khoản quản trị mới xem được trang này.</Empty>

  const update = async (u: UserRow, patch: Partial<UserRow> & { password?: string }, done: string) => {
    try {
      const { user } = await api<{ user: UserRow }>(`/users/${u.id}`, { body: patch })
      setUsers((list) => list?.map((x) => (x.id === user.id ? user : x)) ?? null)
      toast(done)
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
      return false
    }
  }
  const resetPassword = async (u: UserRow) => {
    if (!confirm(`Đặt lại mật khẩu cho ${u.name}? Người này sẽ bị đăng xuất khỏi mọi thiết bị.`)) return
    const password = randomPassword()
    if (await update(u, { password }, `Đã đặt lại mật khẩu cho ${u.name}`)) setShown({ email: u.email, password })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Tài khoản" subtitle="Ai được đăng nhập vào Gaia. Không có trang đăng ký: chỉ quản trị viên tạo tài khoản." />
      <NewUser onCreated={(u, password) => {
        setUsers((list) => [...(list ?? []), u])
        setShown({ email: u.email, password })
      }} />
      {shown && <Credential {...shown} onDone={() => setShown(null)} />}
      <Card title={`Danh sách (${users?.filter((u) => !u.disabled).length ?? '…'} đang hoạt động)`} actions={<Button variant="ghost" className="text-xs" onClick={load}><RefreshCw size={13} />Tải lại</Button>}>
        {error ? <p className="p-5 text-red-700">{error}</p> : !users ? <p className="p-5 text-slate-500">Đang tải…</p> : (
          <table className="w-full text-sm" data-testid="users-table">
            <thead><tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="px-5 py-2 font-medium">Tên</th><th className="py-2 font-medium">Email</th><th className="py-2 font-medium">Vai trò</th>
              <th className="py-2 font-medium">Trạng thái</th><th className="py-2 font-medium">Tạo ngày</th><th className="px-5 py-2" />
            </tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me.id
                return (
                  <tr key={u.id} className={u.disabled ? 'text-slate-400' : ''}>
                    <td className="px-5 py-2 font-medium">{u.name}{self && <span className="ml-1.5 text-xs font-normal text-slate-500">(bạn)</span>}</td>
                    <td className="py-2">{u.email}</td>
                    <td className="py-2">
                      <select aria-label={`Vai trò của ${u.name}`} value={u.role} disabled={self} title={self ? 'Không tự đổi vai trò của chính mình' : undefined}
                        onChange={(e) => update(u, { role: e.target.value as UserRow['role'] }, `${u.name} giờ là ${ROLE_LABEL[e.target.value as UserRow['role']]}`)}>
                        <option value="editor">{ROLE_LABEL.editor}</option>
                        <option value="admin">{ROLE_LABEL.admin}</option>
                      </select>
                    </td>
                    <td className="py-2">{u.disabled ? <Badge>Đã khoá</Badge> : <Badge tone="green">Hoạt động</Badge>}</td>
                    <td className="tnum py-2 text-slate-500">{new Date(u.createdAt).toLocaleDateString('vi-VN')}</td>
                    <td className="whitespace-nowrap px-5 py-2 text-right">
                      <Button variant="ghost" className="text-xs" onClick={() => resetPassword(u)}><KeyRound size={13} />Đặt lại mật khẩu</Button>
                      {!self && (u.disabled
                        ? <Button variant="ghost" className="text-xs" onClick={() => update(u, { disabled: false }, `Đã mở khoá ${u.name}`)}><LockOpen size={13} />Mở khoá</Button>
                        : <Button variant="ghost" className="text-xs text-red-700" onClick={() => confirm(`Khoá tài khoản ${u.name}? Người này bị đăng xuất ngay.`) && update(u, { disabled: true }, `Đã khoá ${u.name}`)}><Lock size={13} />Khoá</Button>)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
      <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck size={13} />Quản trị: thêm, khoá tài khoản và đặt lại mật khẩu. Điều phối: dùng mọi tính năng lịch. Không xoá hẳn tài khoản để lịch sử chỉnh sửa vẫn ghi đúng người.</p>
    </div>
  )
}

function NewUser({ onCreated }: { onCreated: (u: UserRow, password: string) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState(randomPassword)
  const [role, setRole] = useState<UserRow['role']>('editor')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { user } = await api<{ user: UserRow }>('/users', { body: { name, email, password, role } })
      onCreated(user, password)
      toast(`Đã tạo tài khoản ${user.email}`)
      setName('')
      setEmail('')
      setPassword(randomPassword())
      setRole('editor')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><UserPlus size={15} />Thêm tài khoản</span>}>
      <form onSubmit={submit} className="space-y-3 p-5" data-testid="new-user-form">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1"><span className="text-xs font-medium text-slate-500">Tên</span><input required className="w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" /></label>
          <label className="block space-y-1"><span className="text-xs font-medium text-slate-500">Email</span><input required type="email" autoComplete="off" className="w-full" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ten@gaia.vn" /></label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">Mật khẩu (ít nhất 10 ký tự)</span>
            <span className="flex gap-2">
              <input required minLength={10} autoComplete="new-password" className="w-full font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button type="button" title="Tạo mật khẩu ngẫu nhiên" onClick={() => setPassword(randomPassword())}><RefreshCw size={13} /></Button>
            </span>
          </label>
          <label className="block space-y-1"><span className="text-xs font-medium text-slate-500">Vai trò</span>
            <select className="w-full" value={role} onChange={(e) => setRole(e.target.value as UserRow['role'])}>
              <option value="editor">{ROLE_LABEL.editor}: dùng mọi tính năng lịch</option>
              <option value="admin">{ROLE_LABEL.admin}: thêm cả quản lý tài khoản</option>
            </select>
          </label>
        </div>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy}><UserPlus size={14} />Tạo tài khoản</Button>
      </form>
    </Card>
  )
}
