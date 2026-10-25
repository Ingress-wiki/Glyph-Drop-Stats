-- The associated portal's side against the player's, from the faction
-- columns appended to v1 exports. Only the alignment is stored: the portal's
-- and the player's factions are read to check it, then dropped, because
-- either one with the alignment tells the uploader's faction. NULL when
-- unknown: drops, ordinary hacks, older builds and neutral portals.
ALTER TABLE record_versions ADD COLUMN portal_alignment TEXT
  CHECK (portal_alignment IN ('same_faction', 'enemy', 'machina'));
