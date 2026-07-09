-- Private storage buckets + per-user path policies (ADR-0002 §5).
-- Layout: docs/ARCHITECTURE.md §4. Delivery via short-lived signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('letters', 'letters', false, 20971520, array['application/pdf']),
  ('assets', 'assets', false, 5242880, array['image/png', 'image/jpeg', 'image/svg+xml']),
  ('imports', 'imports', false, 10485760, array[
     'text/csv', 'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

-- Users may manage only objects under their own uid/ prefix.
create policy storage_letters_own on storage.objects
  for all to authenticated
  using (bucket_id = 'letters' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'letters' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy storage_assets_own on storage.objects
  for all to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy storage_imports_own on storage.objects
  for all to authenticated
  using (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid())::text);
