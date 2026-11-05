# Gaia API

Node 22 + Hono + PostgreSQL. Server lưu dữ liệu, đăng nhập, lịch sử sửa đổi và chặn sửa trùng; nghiệp vụ (lộ trình, chi phí, đề xuất...) vẫn nằm ở `src/domain` phía client.

## Cách lưu dữ liệu

- Mỗi giáo viên, trường, văn phòng, lịch nghỉ, tuần, ca, số km, km sửa tay và cấu hình là một bản ghi JSON trong bảng `entities` (`collection`, `id`, `data`, `rev`).
- Mỗi lần lưu là một commit có `rev` tăng dần. Client gửi `baseRev` (bản nó đang có). Bản ghi nào bị người khác sửa sau `baseRev` thì cả lần lưu bị từ chối (409); client lấy bản của người kia, báo cho người dùng, rồi gửi lại phần còn lại.
- Client tự lưu khoảng 0,7 giây sau mỗi thao tác và lấy thay đổi của người khác mỗi 15 giây.
- `entity_history` giữ giá trị trước và sau của từng thay đổi kèm người sửa: `GET /api/history`, `GET /api/history?c=teacher&id=VT001`.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | kiểm tra DB |
| POST | `/api/auth/login` | `{email, password}`, đặt cookie httpOnly 30 ngày |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | |
| GET | `/api/state` | toàn bộ dữ liệu; `?since=rev` để lấy phần thay đổi |
| POST | `/api/changes` | `{baseRev, changes: [{c, id, data \| null}]}` |
| GET | `/api/history` | |

## Chạy ở máy

```bash
cd server && npm install
DATABASE_URL=postgres://... npm run dev         # cổng 3000, tự chạy migrations
DATABASE_URL=postgres://... npm run seed -- ../src/data/seed.local.json
DATABASE_URL=postgres://... npm run user -- add ban@gaia.vn "Tên" --admin
npm test                                        # dùng PGlite, không cần Postgres
```

Frontend: `npm run dev` ở thư mục gốc. `.env` đã đặt `VITE_API_URL=/api`, Vite chuyển `/api` sang `localhost:3000` (đổi bằng `API_PROXY`).

## Deploy lên Railway

1. Tạo project, thêm **PostgreSQL**.
2. Thêm service từ repo GitHub, **Root Directory = `server`**. `railway.json` lo phần build, start và health check.
3. Biến của service:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `NODE_ENV` = `production`
   - `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` (ít nhất 10 ký tự): tạo admin đầu tiên khi DB chưa có ai. Đăng nhập được rồi thì xoá `ADMIN_PASSWORD`.
4. Generate domain cho service, ví dụ `gaia-api.up.railway.app`.
5. Nạp dữ liệu thật từ máy điều phối (dùng URL public của Postgres trong tab Variables → `DATABASE_PUBLIC_URL`):
   ```bash
   cd server
   DATABASE_PUBLIC_URL='postgres://...' npm run seed -- ../src/data/seed.local.json
   ```
6. Frontend trên Vercel: thêm rewrite đứng **trước** rewrite hiện có trong `vercel.json` (`VITE_API_URL=/api` đã có trong `.env`):
   ```json
   { "rewrites": [
     { "source": "/api/:path*", "destination": "https://gaia-api.up.railway.app/api/:path*" },
     { "source": "/(.*)", "destination": "/index.html" }
   ] }
   ```
   Đi qua rewrite thì trình duyệt thấy API cùng domain với app, nên cookie đăng nhập hoạt động trên mọi trình duyệt, kể cả Safari. Gọi thẳng domain Railway thì cookie bị chặn vì khác site.

## Dữ liệu cá nhân

Sau bước 5, SĐT và địa chỉ nhà giáo viên nằm trong Postgres trên Railway, chỉ đọc được khi đã đăng nhập. Không có trang đăng ký: chỉ ai được tạo tài khoản bằng `npm run user` mới vào được. Khoá tài khoản bằng `npm run user -- disable <email>`.
