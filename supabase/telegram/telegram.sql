-- Condivisione posizione auto: una riga per utente + invitati Telegram + link pubblico a token
create table if not exists public.parking_share (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lat double precision not null, lon double precision not null,
  name text, ts bigint, updated_at timestamptz default now()
);
alter table public.parking_share add column if not exists display_name text;
alter table public.parking_share add column if not exists token text;
create index if not exists parking_share_token on public.parking_share(token);
alter table public.parking_share enable row level security;
drop policy if exists "ps insert" on public.parking_share; drop policy if exists "ps update" on public.parking_share;
drop policy if exists "ps select" on public.parking_share; drop policy if exists "ps delete" on public.parking_share;
create policy "ps insert" on public.parking_share for insert with check (auth.uid() = user_id);
create policy "ps update" on public.parking_share for update using (auth.uid() = user_id);
create policy "ps select" on public.parking_share for select using (auth.uid() = user_id);
create policy "ps delete" on public.parking_share for delete using (auth.uid() = user_id);

-- inviti monouso (li legge solo il bot con la service key)
create table if not exists public.parking_invites (
  code text primary key, user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now()
);
alter table public.parking_invites enable row level security;
drop policy if exists "pi insert" on public.parking_invites; drop policy if exists "pi delete" on public.parking_invites;
create policy "pi insert" on public.parking_invites for insert with check (auth.uid() = user_id);
create policy "pi delete" on public.parking_invites for delete using (auth.uid() = user_id);

-- contatti Telegram collegati (li scrive il bot, il proprietario li vede e li revoca)
create table if not exists public.parking_contacts (
  user_id uuid not null references auth.users(id) on delete cascade, chat_id text not null, name text,
  created_at timestamptz default now(), primary key (user_id, chat_id)
);
alter table public.parking_contacts enable row level security;
drop policy if exists "pc select" on public.parking_contacts; drop policy if exists "pc delete" on public.parking_contacts;
create policy "pc select" on public.parking_contacts for select using (auth.uid() = user_id);
create policy "pc delete" on public.parking_contacts for delete using (auth.uid() = user_id);

-- lettura pubblica della sola posizione, solo con il token segreto (per la pagina del link)
create or replace function public.get_parking(t text)
returns table(lat double precision, lon double precision, name text, ts bigint, display_name text, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select lat, lon, name, ts, display_name, updated_at from public.parking_share where token = t and length(t) >= 20 limit 1;
$$;
grant execute on function public.get_parking(text) to anon, authenticated;
