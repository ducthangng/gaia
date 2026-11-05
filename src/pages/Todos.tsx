import clsx from 'clsx'
import { Check, MessageSquareReply, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { create } from 'zustand'
import { Button, Card, Empty, PageHeader, toast } from '../components/ui'
import { api } from '../sync/api'
import { useSync } from '../sync/engine'

export interface Todo {
  id: number
  title: string
  detail: string
  done: boolean
  reply: string
  createdAt: string
  updatedAt: string
  doneAt: string | null
  author: { id: number; name: string } | null
  doneBy: string | null
}

/** Danh sách dùng chung cho trang này và số đếm trên menu. */
export const useTodos = create<{ todos: Todo[] | null; error: string | null }>(() => ({ todos: null, error: null }))

export async function loadTodos() {
  try {
    useTodos.setState({ todos: (await api<{ todos: Todo[] }>('/todos')).todos, error: null })
  } catch (e) {
    useTodos.setState({ error: e instanceof Error ? e.message : String(e) })
  }
}

const upsert = (t: Todo) => useTodos.setState((s) => ({ todos: s.todos ? (s.todos.some((x) => x.id === t.id) ? s.todos.map((x) => (x.id === t.id ? t : x)) : [t, ...s.todos]) : [t] }))
const when = (iso: string) => new Date(iso).toLocaleString('vi-VN', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })

type Filter = 'open' | 'done' | 'all'

export function TodosPage() {
  const { todos, error } = useTodos()
  const me = useSync((s) => s.user)
  const [filter, setFilter] = useState<Filter>('open')
  useEffect(() => {
    loadTodos()
  }, [])
  const open = todos?.filter((t) => !t.done) ?? []
  const done = todos?.filter((t) => t.done) ?? []
  const shown = filter === 'open' ? open : filter === 'done' ? done : (todos ?? [])
  const pill = (f: Filter, label: string) => (
    <button aria-pressed={filter === f} onClick={() => setFilter(f)} className={clsx('rounded-full border px-3 py-1 text-xs font-medium', filter === f ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100')}>{label}</button>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Việc cần làm" subtitle={me?.role === 'admin' ? 'Góp ý của mọi người về app. Đánh dấu khi đã xử lý, có thể kèm phản hồi.' : 'Ghi lại chỗ app cần sửa hoặc cần thêm. Quản trị viên sẽ xem và đánh dấu khi xong.'} />
      <Composer />
      <div className="flex items-center gap-2" role="group" aria-label="Lọc">
        {pill('open', `Đang chờ · ${open.length}`)}
        {pill('done', `Đã xong · ${done.length}`)}
        {pill('all', 'Tất cả')}
      </div>
      {error && !todos ? <p className="text-red-700">{error}</p> : !todos ? <p className="text-slate-500">Đang tải…</p> : !shown.length ? (
        <Empty>{filter === 'open' ? 'Không còn việc nào đang chờ.' : 'Chưa có việc nào.'}</Empty>
      ) : (
        <ul className="space-y-2" data-testid="todo-list">{shown.map((t) => <TodoItem key={t.id} todo={t} />)}</ul>
      )}
    </div>
  )
}

function Composer() {
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    try {
      upsert((await api<{ todo: Todo }>('/todos', { body: { title, detail } })).todo)
      setTitle('')
      setDetail('')
      toast('Đã thêm, cảm ơn bạn!')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <form onSubmit={submit} className="space-y-2 p-4" data-testid="todo-form">
        <input aria-label="Việc cần làm" className="w-full" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ví dụ: Trang toàn màn hình cần lọc theo giáo viên" />
        <textarea aria-label="Mô tả chi tiết" className="w-full" rows={2} maxLength={5000} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Chi tiết (không bắt buộc): ở trang nào, làm gì thì gặp, mong muốn ra sao" />
        <div className="flex justify-end"><Button variant="primary" type="submit" disabled={busy || !title.trim()}><Plus size={14} />Thêm việc</Button></div>
      </form>
    </Card>
  )
}

function TodoItem({ todo: t }: { todo: Todo }) {
  const me = useSync((s) => s.user)
  const admin = me?.role === 'admin'
  const own = t.author?.id === me?.id
  const [editing, setEditing] = useState(false)
  const [replying, setReplying] = useState(false)
  const [title, setTitle] = useState(t.title)
  const [detail, setDetail] = useState(t.detail)
  const [reply, setReply] = useState(t.reply)

  const save = async (patch: Partial<Pick<Todo, 'title' | 'detail' | 'done' | 'reply'>>, done?: string) => {
    try {
      upsert((await api<{ todo: Todo }>(`/todos/${t.id}`, { body: patch })).todo)
      if (done) toast(done)
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
      return false
    }
  }
  const remove = async () => {
    if (!confirm(`Xoá "${t.title}"?`)) return
    try {
      await api(`/todos/${t.id}/delete`, { body: {} })
      useTodos.setState((s) => ({ todos: s.todos?.filter((x) => x.id !== t.id) ?? null }))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <li className={clsx('flex gap-3 rounded-lg border bg-white p-3', t.done ? 'border-slate-200' : 'border-slate-300')} data-testid="todo-item">
      <button
        aria-label={t.done ? 'Mở lại' : 'Đánh dấu đã xong'} aria-pressed={t.done} disabled={!admin}
        title={admin ? (t.done ? 'Mở lại' : 'Đánh dấu đã xong') : t.done ? 'Đã xong' : 'Đang chờ quản trị viên xử lý'}
        onClick={() => save({ done: !t.done }, t.done ? 'Đã mở lại' : 'Đã đánh dấu xong')}
        className={clsx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-2 transition', t.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white', admin && !t.done && 'hover:border-emerald-600', !admin && 'cursor-default')}
      >{t.done && <Check size={13} strokeWidth={3} />}</button>
      <div className="min-w-0 flex-1 space-y-1">
        {editing ? (
          <div className="space-y-2">
            <input aria-label="Sửa tiêu đề" className="w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea aria-label="Sửa mô tả" className="w-full" rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="primary" disabled={!title.trim()} onClick={async () => (await save({ title, detail })) && setEditing(false)}>Lưu</Button>
              <Button onClick={() => { setTitle(t.title); setDetail(t.detail); setEditing(false) }}>Huỷ</Button>
            </div>
          </div>
        ) : <>
          <div className={clsx('font-medium', t.done && 'text-slate-500 line-through decoration-slate-300')}>{t.title}</div>
          {t.detail && <p className="whitespace-pre-wrap text-slate-600">{t.detail}</p>}
        </>}
        <div className="text-xs text-slate-500">
          {t.author?.name ?? 'Tài khoản đã xoá'} · {when(t.createdAt)}
          {t.done && t.doneAt && <span className="text-emerald-700"> · {t.doneBy ?? 'Quản trị'} đánh dấu xong {when(t.doneAt)}</span>}
        </div>
        {t.reply && !replying && <div className="rounded-md bg-emerald-50 px-3 py-1.5 text-emerald-900"><span className="text-xs font-medium">Phản hồi: </span><span className="whitespace-pre-wrap">{t.reply}</span></div>}
        {replying && (
          <div className="space-y-2">
            <textarea aria-label="Phản hồi" className="w-full" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Ví dụ: Đã sửa, tải lại trang để thấy" autoFocus />
            <div className="flex gap-2">
              <Button variant="primary" onClick={async () => (await save({ reply }, 'Đã lưu phản hồi')) && setReplying(false)}>Lưu phản hồi</Button>
              {!t.done && <Button onClick={async () => (await save({ reply, done: true }, 'Đã phản hồi và đánh dấu xong')) && setReplying(false)}><Check size={13} />Lưu và đánh dấu xong</Button>}
              <Button variant="ghost" onClick={() => { setReply(t.reply); setReplying(false) }}>Huỷ</Button>
            </div>
          </div>
        )}
      </div>
      {!editing && !replying && (
        <div className="flex shrink-0 items-start gap-0.5">
          {admin && <button aria-label="Phản hồi" title="Phản hồi" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setReplying(true)}><MessageSquareReply size={15} /></button>}
          {(admin || (own && !t.done)) && <button aria-label="Sửa" title="Sửa" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setEditing(true)}><Pencil size={15} /></button>}
          {(admin || (own && !t.done)) && <button aria-label="Xoá" title="Xoá" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700" onClick={remove}><Trash2 size={15} /></button>}
        </div>
      )}
    </li>
  )
}
