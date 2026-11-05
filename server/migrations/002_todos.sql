-- Việc cần làm / góp ý về app: người dùng ghi lại chỗ cần sửa, admin đánh dấu đã xong kèm phản hồi.
create table todos (
  id serial primary key,
  title text not null check (length(title) between 1 and 300),
  detail text not null default '' check (length(detail) <= 5000),
  done boolean not null default false,
  created_by int references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_by int references users(id) on delete set null,
  done_at timestamptz,
  reply text not null default '' check (length(reply) <= 2000)
);
create index todos_open on todos(done, created_at desc);
