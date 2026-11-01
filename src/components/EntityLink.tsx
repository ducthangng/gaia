import clsx from 'clsx'
import { useMemo, type ReactNode } from 'react'
import { buildEntityIndex, tokenizeEntities } from '../domain/entity-text'
import { useStore } from '../store'

const LINK = 'decoration-slate-300 decoration-dotted underline-offset-2 hover:text-emerald-700 hover:decoration-solid hover:underline'

/** Mở hồ sơ trong tab mới, để không mất ngữ cảnh của màn hình đang xem. */
export function EntityAnchor({ kind, id, children, className }: { kind: 'teacher' | 'school'; id: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={`/${kind === 'teacher' ? 'teachers' : 'schools'}/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      data-entity={kind}
      data-entity-id={id}
      title={`Mở hồ sơ ${kind === 'teacher' ? 'giáo viên' : 'trường'} trong tab mới`}
      className={clsx(LINK, 'underline', className)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  )
}

function useEntityIndex() {
  const teachers = useStore((s) => s.teachers)
  const schools = useStore((s) => s.schools)
  return useMemo(() => buildEntityIndex(teachers, schools), [teachers, schools])
}

/** Hiện câu chữ, tự biến tên giáo viên và trường trong đó thành link mở hồ sơ. */
export function EntityText({ text, className }: { text: string; className?: string }) {
  const index = useEntityIndex()
  const tokens = useMemo(() => tokenizeEntities(text, index), [text, index])
  return (
    <span className={className}>
      {tokens.map((t, i) => (t.kind === 'text' ? <span key={i}>{t.text}</span> : <EntityAnchor key={i} kind={t.kind} id={t.id}>{t.text}</EntityAnchor>))}
    </span>
  )
}
