-- 目標達成アプリ：テーブル作成
-- Supabaseの SQL Editor に貼り付けて実行するか、supabase db push で反映してください。

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal text not null,
  deadline date not null,
  daily_minutes int not null check (daily_minutes in (15, 30, 60)),
  available_weekdays int[] not null,
  time_slot text not null default '',
  busy_note text not null default '',
  notes text not null default '',
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  date date not null,
  title text not null,
  minutes int not null check (minutes > 0),
  status text not null default 'pending' check (status in ('pending', 'done', 'missed')),
  original_date date,
  updated_at timestamptz not null default now()
);
create index tasks_plan_date_idx on public.tasks (plan_id, date);

create table public.replans (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  triggered_at timestamptz not null default now(),
  missed_task_ids uuid[] not null default '{}',
  proposal jsonb not null,
  confirmed_at timestamptz
);
create index replans_plan_idx on public.replans (plan_id, triggered_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- updated_at を自動で更新する
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger tasks_touch before update on public.tasks
for each row execute function public.touch_updated_at();

-- 行レベルセキュリティ：自分のデータだけ読み書きできる
alter table public.plans enable row level security;
alter table public.tasks enable row level security;
alter table public.replans enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "own plans" on public.plans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own tasks" on public.tasks
  for all
  using (exists (select 1 from public.plans p where p.id = plan_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.plans p where p.id = plan_id and p.user_id = auth.uid()));

create policy "own replans" on public.replans
  for all
  using (exists (select 1 from public.plans p where p.id = plan_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.plans p where p.id = plan_id and p.user_id = auth.uid()));

create policy "own push subscriptions" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 組み直し案の確定：範囲内の未完了の予定を消し、案の予定に置き換える（一度に行う）
create or replace function public.confirm_replan(p_replan_id uuid, p_proposal jsonb)
returns void
language plpgsql
security invoker
as $$
declare
  r public.replans;
begin
  select * into r from public.replans where id = p_replan_id;
  if not found then
    raise exception '組み直し案が見つかりません';
  end if;
  if r.confirmed_at is not null then
    return;
  end if;

  delete from public.tasks
  where plan_id = r.plan_id
    and status = 'pending'
    and date >= (p_proposal ->> 'window_start')::date
    and date <= (p_proposal ->> 'window_end')::date;

  insert into public.tasks (plan_id, date, title, minutes, status, original_date)
  select
    r.plan_id,
    (t ->> 'date')::date,
    t ->> 'title',
    (t ->> 'minutes')::int,
    'pending',
    nullif(t ->> 'original_date', '')::date
  from jsonb_array_elements(p_proposal -> 'tasks') as t;

  update public.replans
  set proposal = p_proposal, confirmed_at = now()
  where id = p_replan_id;
end $$;
