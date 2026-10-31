-- SAMPLE DATA for the two site-owned tables (organization_responses and
-- corrections in ../pipeline/schema.sql). Everything else the site reads
-- comes from the static JSON under public/data (see `npm run data:local`).
-- The organization ids match the sample profiles in test/fixtures.

INSERT INTO organization_responses (organization_id, text, contact, submitted_at, published) VALUES
  ('org-a000000001', 'The 2026 standing offer covers translation services for three departments; each call-up is reported separately.', 'office@example.invalid', '2026-10-20T15:00:00Z', 1),
  ('org-a000000001', 'A second statement that is still under review.', 'office@example.invalid', '2026-10-21T09:00:00Z', 0);

INSERT INTO corrections (organization_id, page, text, contact, submitted_at, published) VALUES
  ('org-a000000002', '/organizations/org-a000000002', 'The city shown was the old head office; records since 2025 carry the new one.', NULL, '2026-10-22T16:00:00Z', 1);
