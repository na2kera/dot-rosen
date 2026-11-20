-- 路線の有効期限を廃止する（2026-11-20、Issue #1。docs/api.md「3. データベース」）。
-- 索引の付いた列は落とせないので、先に索引を落とす。

DROP INDEX IF EXISTS routes_expires_at;
ALTER TABLE routes DROP COLUMN expires_at;
