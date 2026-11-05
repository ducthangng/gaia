-- Người dùng nội bộ của Gaia. Tài khoản tạo bằng `npm run user add`, không có đăng ký công khai.
create table users (
  id serial primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null default 'editor' check (role in ('admin', 'editor')),
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- Chỉ lưu sha256 của token: lộ bảng này cũng không đăng nhập được.
create table sessions (
  token_hash text primary key,
  user_id int not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sessions(user_id);

-- Mỗi lần lưu là một commit; rev tăng dần dùng để đồng bộ và phát hiện sửa trùng.
create table commits (
  rev bigserial primary key,
  user_id int references users(id) on delete set null,
  at timestamptz not null default now(),
  summary text,
  size int not null
);

-- Mọi bản ghi của app (giáo viên, trường, ca, tuần...) dưới dạng JSON. data null = đã xoá.
create table entities (
  collection text not null,
  id text not null,
  data jsonb,
  rev bigint not null references commits(rev),
  pos bigserial,
  primary key (collection, id)
);
create index entities_rev on entities(rev);

-- Lịch sử thay đổi: ai sửa gì, giá trị trước và sau.
create table entity_history (
  rev bigint not null references commits(rev) on delete cascade,
  collection text not null,
  id text not null,
  before jsonb,
  after jsonb
);
create index entity_history_key on entity_history(collection, id);
create index entity_history_rev on entity_history(rev);
