-- Posizione dell'auto per il bot Telegram: una riga per utente, solo il proprietario la scrive e la legge
create table if not exists public.parking_share (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lat double precision not null,
  lon double precision not null,
  name text,
  ts bigint,
  updated_at timestamptz default now()
);
alter table public.parking_share enable row level security;
create policy "ps insert" on public.parking_share for insert with check (auth.uid() = user_id);
create policy "ps update" on public.parking_share for update using (auth.uid() = user_id);
create policy "ps select" on public.parking_share for select using (auth.uid() = user_id);
create policy "ps delete" on public.parking_share for delete using (auth.uid() = user_id);
