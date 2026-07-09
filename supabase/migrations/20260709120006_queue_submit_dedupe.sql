-- Exactly one live submit_item job per send_job_item.
--
-- Several call sites enqueue submit jobs for the same item (top-up webhook,
-- admin credit adjustment, maintenance sweep for held items). Without this
-- index two queue rows could exist and be claimed by two concurrent worker
-- invocations; the item-level compare-and-set narrows but does not eliminate
-- that window, leaving the provider's duplicate failsafe as the only guard.
-- A partial unique index removes the duplicate at the source.

create unique index if not exists uq_job_queue_submit_item_live
  on public.job_queue ((payload ->> 'itemId'))
  where type = 'submit_item' and status in ('pending', 'running');
