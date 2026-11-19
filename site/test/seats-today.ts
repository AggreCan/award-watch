// What an account in no group sent and read before slice P2 (test/seats-service.test.ts), captured by running
// that file's own fixtures on main at 8201080, before any of the slice's code was written, and pasted here.
// Never rebuilt from the code under test: a change that adds a statement for an account in no group, or
// changes a byte of its pages, fails against it. STATEMENTS holds each statement text once; every list below
// is places in it. A page's body is the first 12 bytes of SHA-256 of the page with its CSRF value taken out.

export const STATEMENTS: readonly string[] = [
  "SELECT s.id, s.user_id, s.kind, s.params, s.label, s.lang, s.deliver, s.last_delivered_at, u.email, u.plan, u.plan_until, k.secret, u.lang AS user_lang, (SELECT COUNT(*) FROM saved_searches x WHERE x.user_id = s.user_id AND (x.created_at < s.created_at OR (x.created_at = s.created_at AND x.id < s.id))) + (SELECT COUNT(*) FROM briefings x WHERE x.user_id = s.user_id AND (x.created_at < s.created_at OR (x.created_at = s.created_at AND x.id < s.id))) AS n_before FROM saved_searches s JOIN users u ON u.id = s.user_id LEFT JOIN delivery_tokens k ON k.search_id = s.id WHERE u.status = 'active' AND s.deliver IN ('daily', 'weekly') AND s.kind IN (?, ?, ?, ?, ?) AND (s.last_delivered_at IS NULL OR substr(s.last_delivered_at, 1, 10) < ?) AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.saved_search_id = s.id AND d.status = 'failed' AND d.sent_at >= ?) ORDER BY u.plan = 'free', s.created_at, s.id",
  "DELETE FROM deliveries WHERE id < COALESCE((SELECT id FROM deliveries WHERE sent_at >= ?1 ORDER BY id LIMIT 1), (SELECT MAX(id) + 1 FROM deliveries))",
  "SELECT 'own' AS via, e.id, COALESCE(t.tier, e.plan) AS plan, e.starts_at, e.ends_at, e.created_at, e.revoked_at, NULL AS holder_id, NULL AS holder_email, NULL AS holder_ok, NULL AS member_id, NULL AS joined_at, NULL AS seat_id FROM entitlements e LEFT JOIN entitlement_tiers t ON t.entitlement_id = e.id WHERE e.user_id = ?1 UNION ALL SELECT 'held', e.id, COALESCE(t.tier, e.plan), e.starts_at, e.ends_at, e.created_at, e.revoked_at, s.holder_id, h.email, h.status = 'active' AND NOT EXISTS (SELECT 1 FROM account_blocks b WHERE b.user_id = s.holder_id), NULL, NULL, s.id FROM seats s JOIN users h ON h.id = s.holder_id LEFT JOIN entitlements e ON e.user_id = s.holder_id LEFT JOIN entitlement_tiers t ON t.entitlement_id = e.id WHERE s.member_id = ?1 AND s.ended_at IS NULL UNION ALL SELECT 'seat', NULL, NULL, NULL, NULL, NULL, NULL, g.holder_id, NULL, NULL, g.member_id, g.joined_at, g.id FROM seats g WHERE g.holder_id = COALESCE((SELECT holder_id FROM seats WHERE member_id = ?1 AND ended_at IS NULL), ?1) AND g.member_id IS NOT NULL AND g.ended_at IS NULL",
  "UPDATE saved_searches SET last_delivered_at = ? WHERE id = ? AND deliver IN ('daily', 'weekly') AND (last_delivered_at IS NULL OR substr(last_delivered_at, 1, 10) < ?)",
  "INSERT INTO deliveries (saved_search_id, sent_at, items, status) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM saved_searches WHERE id = ?1)",
  "UPDATE saved_searches SET last_delivered_at = ? WHERE id = ?",
  "INSERT INTO delivery_tokens (search_id, secret, created_at) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM saved_searches WHERE id = ?1) ON CONFLICT (search_id) DO NOTHING",
  "SELECT secret FROM delivery_tokens WHERE search_id = ?",
  "UPDATE saved_searches SET last_delivered_at = ?1 WHERE id = ?2 AND deliver IN ('daily', 'weekly') AND (last_delivered_at IS NULL OR substr(last_delivered_at, 1, 10) < ?3)",
  "SELECT m.user_id, m.secret, m.last_day, m.last_at, u.email, u.lang, u.plan, u.plan_until FROM watch_mail m JOIN users u ON u.id = m.user_id WHERE u.status = 'active' AND m.mail = 'on' AND (m.last_day IS NULL OR m.last_day < ?1) AND (m.failed_day IS NULL OR m.failed_day < ?1) AND EXISTS (SELECT 1 FROM watches w WHERE w.user_id = m.user_id) AND NOT EXISTS (SELECT 1 FROM account_blocks b WHERE b.user_id = m.user_id) ORDER BY u.plan = 'free', m.created_at, m.user_id LIMIT ?2",
  "DELETE FROM watch_deliveries WHERE sent_at < ?",
  "SELECT id, kind, target, segment, label, events, cadence, created_at, last_sent_day FROM watches WHERE user_id = ? ORDER BY created_at, id LIMIT 101",
  "SELECT b.id, b.user_id, b.kind, b.subject, b.segment, b.label, b.lang, b.deliver, b.last_delivered_at, b.secret, u.email, u.plan, u.plan_until, (SELECT COUNT(*) FROM saved_searches x WHERE x.user_id = b.user_id AND (x.created_at < b.created_at OR (x.created_at = b.created_at AND x.id < b.id))) + (SELECT COUNT(*) FROM briefings x WHERE x.user_id = b.user_id AND (x.created_at < b.created_at OR (x.created_at = b.created_at AND x.id < b.id))) AS n_before FROM briefings b JOIN users u ON u.id = b.user_id WHERE b.deliver = 'weekly' AND u.status = 'active' AND (b.last_delivered_at IS NULL OR substr(b.last_delivered_at, 1, 10) < ?1) AND NOT EXISTS (SELECT 1 FROM briefing_deliveries d WHERE d.briefing_id = b.id AND d.status = 'failed' AND d.sent_at >= ?1) AND NOT EXISTS (SELECT 1 FROM account_blocks x WHERE x.user_id = b.user_id) ORDER BY u.plan = 'free', b.created_at, b.id LIMIT ?2",
  "DELETE FROM briefing_deliveries WHERE sent_at < ?",
  "SELECT m.user_id, m.secret, m.last_week, m.last_at, u.email, u.lang, u.plan, u.plan_until FROM weekly_mail m JOIN users u ON u.id = m.user_id WHERE m.mail = 'on' AND u.status = 'active' AND (m.last_week IS NULL OR m.last_week < ?1) AND (m.failed_week IS NULL OR m.failed_week < ?1) AND m.on_at < ?1 AND NOT EXISTS (SELECT 1 FROM account_blocks b WHERE b.user_id = m.user_id) ORDER BY m.on_at, m.user_id LIMIT ?2",
  "SELECT 1 AS x FROM entitlement_tiers LIMIT 1",
  "SELECT v.id, v.user_id, v.kind, v.address, v.name, v.lang, v.deliver, v.last_delivered_at, v.last_hash, v.secret, u.email, u.plan, u.plan_until, (SELECT COUNT(*) FROM saved_views x WHERE x.user_id = v.user_id AND (x.created_at < v.created_at OR (x.created_at = v.created_at AND x.id < v.id))) AS n_before FROM saved_views v JOIN users u ON u.id = v.user_id WHERE v.deliver IN ('weekly', 'monthly') AND u.status = 'active' AND (v.last_delivered_at IS NULL OR substr(v.last_delivered_at, 1, 10) < (CASE v.deliver WHEN 'weekly' THEN ?1 ELSE ?2 END)) AND NOT EXISTS (SELECT 1 FROM view_deliveries d WHERE d.view_id = v.id AND d.status = 'failed' AND d.sent_at >= (CASE v.deliver WHEN 'weekly' THEN ?1 ELSE ?2 END)) AND NOT EXISTS (SELECT 1 FROM account_blocks x WHERE x.user_id = v.user_id) ORDER BY u.plan = 'free', v.created_at, v.id LIMIT ?3",
  "DELETE FROM view_deliveries WHERE sent_at < ?",
  "INSERT INTO delivery_runs (at, data_date, outcome, sent, failed, left_due, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  "DELETE FROM delivery_runs WHERE at < ?1",
  "SELECT k.id, k.key_hash, k.revoked_at, k.last_used_at, k.user_id, u.status, u.plan, u.plan_until FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.prefix = ?",
  "SELECT 1 AS b FROM account_blocks WHERE user_id = ?",
  "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
  "INSERT INTO api_usage (key_id, day, n) VALUES (?1, ?2, 1) ON CONFLICT (key_id, day) DO UPDATE SET n = api_usage.n + 1 WHERE api_usage.n < ?3 RETURNING n",
  "SELECT d.briefing_id, d.sent_at, d.day, d.items, d.status FROM briefing_deliveries d WHERE d.id IN (SELECT MAX(x.id) FROM briefing_deliveries x JOIN briefings b ON b.id = x.briefing_id WHERE b.user_id = ? GROUP BY x.briefing_id)",
  "SELECT d.saved_search_id, d.sent_at, d.items, d.status FROM deliveries d WHERE d.id IN (SELECT MAX(x.id) FROM deliveries x JOIN saved_searches s ON s.id = x.saved_search_id WHERE s.user_id = ? GROUP BY x.saved_search_id)",
  "SELECT id, kind, params, label, lang, created_at, deliver FROM saved_searches WHERE user_id = ? ORDER BY created_at, id",
  "SELECT id, kind, search_id, secret, created_at, revoked_at, last_read_day FROM feeds WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at, id",
  "SELECT id, kind, subject, segment, label, lang, created_at, deliver, last_delivered_at FROM briefings WHERE user_id = ? ORDER BY created_at, id LIMIT 100",
  "SELECT s.id, s.token_hash, s.expires_at, s.revoked_at, s.last_seen_at, u.id AS user_id, u.email, u.lang, u.status, u.plan, u.plan_until, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
  "SELECT mail, last_day, last_at, last_status, last_items FROM watch_mail WHERE user_id = ?",
  "SELECT organization_id, segment, competitors, created_at, updated_at FROM org_claims WHERE user_id = ? LIMIT 1",
  "SELECT id, kind, address, name, lang, deliver, created_at, last_delivered_at FROM saved_views WHERE user_id = ? ORDER BY created_at, id LIMIT 50",
  "SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC, id",
  "SELECT d.view_id, d.sent_at, d.day, d.status FROM view_deliveries d WHERE d.id IN (SELECT MAX(x.id) FROM view_deliveries x JOIN saved_views v ON v.id = x.view_id WHERE v.user_id = ? GROUP BY x.view_id)",
  "SELECT key_id, SUM(CASE WHEN day = ?2 THEN n ELSE 0 END) AS today, SUM(n) AS last30 FROM api_usage WHERE key_id IN (SELECT id FROM api_keys WHERE user_id = ?1) AND day BETWEEN ?3 AND ?2 GROUP BY key_id",
  "SELECT id, name, pos, created_at FROM dashboards WHERE user_id = ? ORDER BY pos, created_at, id LIMIT 20",
  "SELECT d.id, d.name, d.pos, d.created_at, (SELECT COUNT(*) FROM dashboard_tiles t WHERE t.dashboard_id = d.id) AS n FROM dashboards d WHERE d.user_id = ? ORDER BY d.pos, d.created_at, d.id LIMIT 20",
  "SELECT id, dashboard_id, kind, ref, opts, x, y, w, h FROM dashboard_tiles WHERE user_id = ?1 AND dashboard_id = (SELECT id FROM dashboards WHERE user_id = ?1 ORDER BY pos, created_at, id LIMIT 1) ORDER BY y, x, id LIMIT 50",
  "SELECT id, kind, ref, pos, wide, created_at FROM dashboard_panels WHERE user_id = ? ORDER BY pos, created_at, id LIMIT 50",
];

// The delivery run, in order (101 queries); the run sent 2 messages.
export const RUN_MAIL = 2;
export const RUN: readonly number[] = [0, 1, 2, 3, 4, 5, 3, 6, 7, 4, 5, 2, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 4, 5, 3, 6, 7, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

// The key check and /api/v1/me, in order, by the key's plan.
export const KEYS: Readonly<Record<string, { status: number; sent: readonly number[] }>> = {
  "pro": { status: 200, sent: [20, 21, 2, 22, 23] },
  "ultra": { status: 200, sent: [20, 21, 2, 22, 23] },
};

// Each list page by plan and address: its status, its body's hash, and its statements sorted.
export const PAGES: Readonly<Record<string, { status: number; body: string; sent: readonly number[] }>> = {
  "free_/account/searches": { status: 200, body: "59472ba0c51cf57b3ea81bc0", sent: [2, 15, 24, 25, 26, 27, 28, 29] },
  "free_/account/watches": { status: 200, body: "8e29650e3bd7bff08b8a6cba", sent: [2, 15, 27, 11, 30, 31, 29] },
  "free_/account/views": { status: 200, body: "9a3fd5a3cbb129938237180a", sent: [2, 15, 32, 29] },
  "free_/account/keys": { status: 200, body: "8ea6e826b3d8d122a7e856dd", sent: [2, 15, 33, 29] },
  "free_/account/dashboard": { status: 200, body: "9221992b387eb283bbdb0480", sent: [2, 15, 29] },
  "free_/account/searches?lang=fr": { status: 200, body: "923bc78c1f0d3f364576a22f", sent: [2, 15, 24, 25, 26, 27, 28, 29] },
  "free_/account/watches?lang=fr": { status: 200, body: "2f8a2a3f3ea4ee9d4f81ec88", sent: [2, 15, 27, 11, 30, 31, 29] },
  "free_/account/views?lang=fr": { status: 200, body: "3ffd965fb888a0872a5564fa", sent: [2, 15, 32, 29] },
  "free_/account/keys?lang=fr": { status: 200, body: "c96cf21c3f5fbeb0ea7844b1", sent: [2, 15, 33, 29] },
  "free_/account/dashboard?lang=fr": { status: 200, body: "903ad3f457e9b6885fbe615d", sent: [2, 15, 29] },
  "pro_/account/searches": { status: 200, body: "ebce0b3d6892761eed32f19c", sent: [2, 15, 24, 25, 26, 27, 28, 29] },
  "pro_/account/watches": { status: 200, body: "65041d6083cb286e8c017417", sent: [2, 15, 27, 11, 30, 31, 29] },
  "pro_/account/views": { status: 200, body: "949fe8d75bfc61bc644f2060", sent: [2, 15, 34, 32, 29] },
  "pro_/account/keys": { status: 200, body: "72456f79269199bd000604f1", sent: [2, 15, 33, 35, 29] },
  "pro_/account/dashboard": { status: 200, body: "e5967f8aa58cfa0841d84d99", sent: [2, 15, 29] },
  "pro_/account/searches?lang=fr": { status: 200, body: "73543d8fd655e50e26cea015", sent: [2, 15, 24, 25, 26, 27, 28, 29] },
  "pro_/account/watches?lang=fr": { status: 200, body: "bba9c879212a8d0cff6e0418", sent: [2, 15, 27, 11, 30, 31, 29] },
  "pro_/account/views?lang=fr": { status: 200, body: "dd1180149ba750c773ae0c0c", sent: [2, 15, 34, 32, 29] },
  "pro_/account/keys?lang=fr": { status: 200, body: "8b8463e97b5ceede0930ec6e", sent: [2, 15, 33, 35, 29] },
  "pro_/account/dashboard?lang=fr": { status: 200, body: "4782660be53de06d34f5a400", sent: [2, 15, 29] },
  "ultra_/account/searches": { status: 200, body: "a2db8ff51d6ed7ede86c3e0e", sent: [2, 24, 25, 26, 27, 28, 36, 29] },
  "ultra_/account/watches": { status: 200, body: "4f02d105af5bb6ef7b411e0f", sent: [2, 27, 11, 30, 31, 29] },
  "ultra_/account/views": { status: 200, body: "852c6a4a0d312ded3f09d96a", sent: [2, 15, 34, 32, 36, 29] },
  "ultra_/account/keys": { status: 200, body: "872d4e2ee0cc32698ec39c5c", sent: [2, 33, 35, 29] },
  "ultra_/account/dashboard": { status: 200, body: "1373af7b319d865aff09f15e", sent: [2, 15, 37, 38, 32, 26, 39, 28, 11, 33, 31, 29] },
  "ultra_/account/searches?lang=fr": { status: 200, body: "73d5e8df31bcb531f4f6e320", sent: [2, 24, 25, 26, 27, 28, 36, 29] },
  "ultra_/account/watches?lang=fr": { status: 200, body: "22d0514446bdefd74d5b7964", sent: [2, 27, 11, 30, 31, 29] },
  "ultra_/account/views?lang=fr": { status: 200, body: "966282e362338a872fa06a4c", sent: [2, 15, 34, 32, 36, 29] },
  "ultra_/account/keys?lang=fr": { status: 200, body: "4a3d1c0651e6ae6ec9855122", sent: [2, 33, 35, 29] },
  "ultra_/account/dashboard?lang=fr": { status: 200, body: "1ce4eefac71b39b363728138", sent: [2, 15, 37, 38, 32, 26, 39, 28, 11, 33, 31, 29] },
};
