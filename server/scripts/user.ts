/**
 * Quản lý tài khoản (không có trang đăng ký công khai).
 *
 *   npm run user -- add <email> "<Tên>" [--admin]     # hỏi mật khẩu; cũng dùng để đặt lại mật khẩu
 *   npm run user -- disable <email>
 *   npm run user -- list
 */
import { createInterface } from 'node:readline/promises'
import { createUser, disableUser } from '../src/auth'
import { createPool, migrate } from '../src/db'

const [cmd, email, name] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL
if (!url || !cmd) {
  console.error('Cách dùng: DATABASE_URL=... npm run user -- add|disable|list ...')
  process.exit(1)
}

async function askPassword() {
  if (process.env.GAIA_PASSWORD) return process.env.GAIA_PASSWORD
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const pw = await rl.question('Mật khẩu (ít nhất 10 ký tự): ')
  rl.close()
  return pw
}

const db = createPool(url)
try {
  await migrate(db)
  if (cmd === 'add' && email) {
    const id = await createUser(db, email, name ?? email, await askPassword(), process.argv.includes('--admin') ? 'admin' : 'editor')
    console.log(`Đã lưu tài khoản #${id} ${email}`)
  } else if (cmd === 'disable' && email) {
    console.log((await disableUser(db, email)) ? `Đã khoá ${email}` : `Không có ${email}`)
  } else if (cmd === 'list') {
    const { rows } = await db.query('select id, email, name, role, disabled, created_at from users order by id')
    console.table(rows)
  } else {
    console.error('Lệnh không hợp lệ')
    process.exitCode = 1
  }
} finally {
  await db.end()
}
