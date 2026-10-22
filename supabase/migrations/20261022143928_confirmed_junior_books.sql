-- Client supplied original artwork and confirmed R320 for Grades 1 and 2.
-- Preserve book row IDs and any existing school-specific price overrides.
update public.books set sku='801', default_price_cents=32000,
  cover_path='/assets/images/grade-1/cover.png', active=true
where sku='GRADE-1-PENDING';
update public.books set sku='802', default_price_cents=32000,
  cover_path='/assets/images/grade-2/cover.png', active=true
where sku='GRADE-2-PENDING';
