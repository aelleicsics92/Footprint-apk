-- Esegui in SQL Editor dopo aver sostituito ADMIN_UID con il tuo id (Authentication > Users > il tuo utente > User UID)
create policy "admin legge tutto" on public.backups for select
  using (auth.uid() = 'ADMIN_UID'::uuid);
create policy "admin legge media" on storage.objects for select
  using (bucket_id = 'media' and auth.uid() = 'ADMIN_UID'::uuid);
