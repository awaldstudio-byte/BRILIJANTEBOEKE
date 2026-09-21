alter table public.school_access
  add column code_hint text
  check (code_hint is null or code_hint ~ '^[A-Z0-9]{4}$');

comment on column public.school_access.code_hint is
  'Last four characters of the current parent access code. The full code is never stored.';
