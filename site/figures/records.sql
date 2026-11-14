-- The sample records the guides' figures are drawn from (docs/guides.md,
-- Figures), as rows of the records database (pipeline/records_schema.sql):
-- the published contracts and the standing offer whose pages the figures
-- capture. They are not real records. Every supplier is plainly a sample;
-- the buyers are federal institutions, which are public bodies. Reference
-- numbers, dates, amounts and codes follow the real formats. Amounts are in
-- cents, as the table keeps them.

INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', '2026-11-13'), ('rules', '2');

INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES
  (1, 'nrcan-rncan', 'Natural Resources Canada', 'Ressources naturelles Canada'),
  (2, 'isc-sac', 'Indigenous Services Canada', 'Services aux Autochtones Canada'),
  (3, 'dfo-mpo', 'Fisheries and Oceans Canada', 'Pêches et Océans Canada');

INSERT INTO rec_orgs (oid, name) VALUES
  (1, 'Sample Supplier Inc.'),
  (2, 'Sample Consulting Ltd.'),
  (3, 'Sample Marine Services Ltd.'),
  (5, 'Sample Translation Inc.'),
  (6, 'Sample Language Services Ltd.'),
  (7, 'Sample Linguistics Inc.');

-- Each published contract row's counted value (records.cents), as the radar and the totals read it.
INSERT INTO records (k, src, fy, fq, bid, oid, cents, vnote, comp, meth, ref, title) VALUES
  (101, 3, 2026, 2, 1, 1, 9875000, 0, 0, 'AC', 'nrcan-rncan:C-2026-2027-Q2-90231', 'Licence for seismic interpretation software'),
  (102, 3, 2026, 2, 2, 2, 18645000, 0, 1, 'OB', 'isc-sac:C-2026-2027-Q2-90117', 'Water treatment plant operator training'),
  (103, 3, 2025, 3, 3, 3, 21300000, 0, 1, 'OB', 'dfo-mpo:C-2025-2026-Q3-90412', 'Vessel hull inspection services'),
  (104, 3, 2026, 2, 3, 3, 3450000, 0, 1, 'OB', 'dfo-mpo:C-2026-2027-Q2-90088', 'Vessel hull inspection services');

-- A contract awarded after an advance contract award notice (the guide on ACANs); one under a mandatory set-aside
-- (the guide on set-asides); and an original row and its amendment, one contract by its procurement number (the
-- guide on the three records, where it is the contract of the award notice and the PSPC contract history record).
INSERT INTO rec_contracts (k, dept, ref, pid, bid, oid, wh, cdate, start, endd, value, orig, amend, proc, comp, ctype, inst, period, bids, desc_en, desc_fr) VALUES
  (101, 'nrcan-rncan', 'C-2026-2027-Q2-90231', '5099900231', 1, 1, 0, '2026-09-18', '2026-10-01', '2027-03-31', 9875000, 9875000, NULL, 'AC', 0, 'S', 'C',
    '2026-2027-Q2', 1, 'Licence for seismic interpretation software', 'Licence de logiciel d''interprétation sismique'),
  (102, 'isc-sac', 'C-2026-2027-Q2-90117', '4599900117', 2, 2, 0, '2026-08-14', '2026-09-01', '2027-03-31', 18645000, 18645000, NULL, 'OB', 1, 'S', 'C',
    '2026-2027-Q2', 4, 'Water treatment plant operator training', 'Formation des opérateurs d''usines de traitement de l''eau'),
  (103, 'dfo-mpo', 'C-2025-2026-Q3-90412', 'CW9391528', 3, 3, 0, '2025-11-20', '2025-12-01', '2026-11-30', 21300000, 21300000, NULL, 'OB', 1, 'S', 'C',
    '2025-2026-Q3', 3, 'Vessel hull inspection services', 'Services d''inspection de coques de navires'),
  (104, 'dfo-mpo', 'C-2026-2027-Q2-90088', 'CW9391528', 3, 3, 0, '2026-08-05', '2025-12-01', '2027-05-31', 24750000, 21300000, 3450000, 'OB', 1, 'S', 'A',
    '2026-2027-Q2', 3, 'Vessel hull inspection services', 'Services d''inspection de coques de navires');

INSERT INTO rec_contract_indigenous (k, psib, ib) VALUES (102, 'MS', 0);

-- A national master standing offer and its three holders (the guide on standing offers), with the call-ups the
-- published contracts record against it: [organization number, rows, cents, rows with no value].
INSERT INTO rec_instruments (k, agr, type_en, type_fr, desc_en, desc_fr, gsin, gsin_en, gsin_fr, user_en, user_fr, buyer, start, expiry, segs, tref, n, nw, seen, last, calls) VALUES
  (201, 'EN578-991533/001/ZT', 'National Master Standing Offer', 'Offre à commandes principale et nationale',
    'Translation services, official languages', 'Services de traduction, langues officielles',
    '82111701', '82111701 - Written translation services', '82111701 - Services de traduction écrite',
    'All federal departments and agencies', 'Tous les ministères et organismes fédéraux', NULL, '2025-04-01', '2028-03-31', ' 82 ', NULL,
    3, 0, '2025-04-07', '2026-11-10', '[[5,12,8640000,0],[6,7,3912500,0],[7,0,null,0]]');

INSERT INTO rec_holders (k, ik, oid, name, op, region, region_en, region_fr, seen) VALUES
  (301, 201, 5, 'Sample Translation Inc.', NULL, 'ON', NULL, NULL, '2025-04-07'),
  (302, 201, 5, 'Sample Translation Inc.', NULL, 'QC', NULL, NULL, '2025-04-07'),
  (303, 201, 6, 'Sample Language Services Ltd.', NULL, 'NS', NULL, NULL, '2025-04-07'),
  (304, 201, 6, 'Sample Language Services Ltd.', NULL, 'NB', NULL, NULL, '2025-04-07'),
  (305, 201, 7, 'Sample Linguistics Inc.', NULL, 'BC', NULL, NULL, '2025-10-06');
