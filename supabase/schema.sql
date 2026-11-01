-- Footprint: schema Supabase. Esegui tutto in SQL Editor > New query > Run.
-- Ogni installazione entra con accesso anonimo (auth.uid()) e vede SOLO i propri dati (RLS).

create table if not exists public.backups (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('waypoint','track','settings')),
  item_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, item_id)
);
alter table public.backups enable row level security;

create policy "owner select" on public.backups for select using (auth.uid() = user_id);
create policy "owner insert" on public.backups for insert with check (auth.uid() = user_id);
create policy "owner update" on public.backups for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner delete" on public.backups for delete using (auth.uid() = user_id);

-- Foto e memo vocali: bucket privato, ogni utente solo nella propria cartella (<user_id>/...)
insert into storage.buckets (id, name, public) values ('media', 'media', false) on conflict (id) do nothing;
create policy "media select" on storage.objects for select using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media insert" on storage.objects for insert with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media update" on storage.objects for update using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media delete" on storage.objects for delete using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
