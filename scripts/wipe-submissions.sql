-- Deletes every submission and everything it supplied, keeping the schema:
-- for the end of a test period (`npm run db:wipe:production`). Children
-- before parents, for the foreign keys. Statistics read only these tables,
-- so they come back empty. The tests reset their database with this file.
DELETE FROM upload_records;
DELETE FROM accepted_versions;
DELETE FROM items;
DELETE FROM panels;
DELETE FROM record_versions;
DELETE FROM uploads;
