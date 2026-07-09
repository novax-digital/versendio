-- Seeds: default plan, pricing table (EK from the official 2025 price list,
-- docs/reference/epost/preisliste-api-2025.md), app settings.
-- Admin user is promoted separately via `npm run seed:admin` (needs auth API).

-- Default plan
insert into public.plans (name, description, discount_percent, is_default)
values ('Standard', 'Standardpreise ohne Rabatt', 0, true)
on conflict (name) do nothing;

-- Pricing: EK = Deutsche Post net prices valid from 2025-01-01.
-- VK = initial margin proposal (~+40%, rounded); adjust in the admin console.
insert into public.pricing_table
  (option_key, display_name_de, kind, zone, ek_cents, vk_cents, active, sort_order)
values
  -- Tier: Standard (bis 20 g, inkl. 1 Blatt)
  ('tier_standard_bw_simplex',  'Standard S/W einseitig',        'tier', 'national',  80, 110, true, 10),
  ('tier_standard_bw_duplex',   'Standard S/W beidseitig',       'tier', 'national',  81, 115, true, 11),
  ('tier_standard_color_simplex', 'Standard Farbe einseitig',    'tier', 'national',  83, 115, true, 12),
  ('tier_standard_color_duplex',  'Standard Farbe beidseitig',   'tier', 'national',  90, 125, true, 13),
  -- Tier: Kompakt (bis 50 g, inkl. 4 Blatt)
  ('tier_kompakt_bw_simplex',   'Kompakt S/W einseitig',         'tier', 'national', 112, 155, true, 20),
  ('tier_kompakt_bw_duplex',    'Kompakt S/W beidseitig',        'tier', 'national', 116, 160, true, 21),
  ('tier_kompakt_color_simplex', 'Kompakt Farbe einseitig',      'tier', 'national', 124, 175, true, 22),
  ('tier_kompakt_color_duplex',  'Kompakt Farbe beidseitig',     'tier', 'national', 152, 215, true, 23),
  -- Tier: Groß (bis 500 g, inkl. 10 Blatt)
  ('tier_gross_bw_simplex',     'Groß S/W einseitig',            'tier', 'national', 195, 275, true, 30),
  ('tier_gross_bw_duplex',      'Groß S/W beidseitig',           'tier', 'national', 205, 285, true, 31),
  ('tier_gross_color_simplex',  'Groß Farbe einseitig',          'tier', 'national', 225, 315, true, 32),
  ('tier_gross_color_duplex',   'Groß Farbe beidseitig',         'tier', 'national', 295, 415, true, 33),
  -- Extra sheet (ab dem 11. Blatt)
  ('extra_sheet_bw_simplex',    'Weiteres Blatt S/W einseitig',  'extra_sheet', 'national',  4,  6, true, 40),
  ('extra_sheet_bw_duplex',     'Weiteres Blatt S/W beidseitig', 'extra_sheet', 'national',  5,  8, true, 41),
  ('extra_sheet_color_simplex', 'Weiteres Blatt Farbe einseitig','extra_sheet', 'national',  7, 11, true, 42),
  ('extra_sheet_color_duplex',  'Weiteres Blatt Farbe beidseitig','extra_sheet','national', 14, 21, true, 43),
  -- Registered-mail surcharges: EK TODO — not part of the API price list;
  -- take from the current DP "Leistungen und Preise" directory. VK provisional.
  ('surcharge_registered_einwurf',      'Einschreiben Einwurf',   'surcharge', 'national', null, 350, true, 50),
  ('surcharge_registered_einschreiben', 'Einschreiben',           'surcharge', 'national', null, 400, true, 51),
  ('surcharge_registered_rueckschein',  'Einschreiben Rückschein','surcharge', 'national', null, 650, true, 52)
on conflict (option_key) do nothing;

-- App settings (admin-editable)
insert into public.app_settings (key, value)
values
  ('topup_amounts_cents',      '[1000, 2500, 5000, 10000]'),
  ('topup_min_cents',          '1000'),
  ('low_credit_threshold_cents', '500'),
  ('queue_batch_size',         '10'),
  ('status_sync_interval_minutes', '15'),
  ('status_sync_max_queries_per_run', '50'),
  ('mock_fail_percent',        '2'),
  ('mock_status_step_minutes', '2')
on conflict (key) do nothing;
