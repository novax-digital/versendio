-- MOCO hardening after the adversarial review of the initial integration:
--
-- 1) Per-RULE activation watermarks. A single shared activated_at meant that
--    enabling a second rule months later inherited the old watermark and
--    auto-mailed (and charged) the entire backlog of the newly enabled type.
alter table public.moco_accounts
  add column if not exists invoices_activated_at timestamptz,
  add column if not exists reminders_activated_at timestamptz;
update public.moco_accounts set invoices_activated_at = activated_at where auto_send_invoices;
update public.moco_accounts set reminders_activated_at = activated_at where auto_send_reminders;
alter table public.moco_accounts drop column if exists activated_at;

-- 2) Document ledger hardening:
--    - subdomain in the dedup identity: MOCO ids are small per-tenant
--      sequences, so switching the connection to another MOCO account must
--      not let old ledger rows shadow colliding new documents.
--    - address_invoice_id: the linked invoice carrying the recipient address,
--      persisted at claim time so crash-resumed reminder claims can re-resolve
--      the address instead of dead-ending.
--    - attempts: optimistic-concurrency token (two concurrent syncs can never
--      process the same claim) and retry cap for poisoned documents.
alter table public.moco_documents
  add column if not exists subdomain text not null default '',
  add column if not exists address_invoice_id bigint,
  add column if not exists attempts integer not null default 0;
update public.moco_documents d
  set subdomain = a.subdomain
  from public.moco_accounts a
  where a.user_id = d.user_id and d.subdomain = '';
drop index if exists public.uq_moco_documents_doc;
create unique index uq_moco_documents_doc
  on public.moco_documents (user_id, subdomain, doc_type, moco_id);
