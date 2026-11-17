-- Consolidate organizations.
--
-- Earlier versions inserted the default organization on every migration run
-- because `organizations.name` was not unique.  That produced several empty
-- organizations (and duplicate demo accounts, one per organization).  Login
-- looks users up by email, so an arbitrary stale account could be selected.
--
-- Keep the organization that actually owns data (falling back to the oldest
-- one), delete the empty duplicates, then prevent the situation from repeating.
--
-- IMPORTANT: this file is re-run on every migration run, so the delete must be
-- limited to genuine duplicates (same name).  Deleting "every empty
-- organization" would also remove the hidden platform organization and any
-- freshly created faculty that does not have students yet.

WITH ranked AS (
  SELECT o.id,
         ROW_NUMBER() OVER (
           ORDER BY (SELECT count(*) FROM students s WHERE s.organization_id = o.id) DESC,
                    (SELECT count(*) FROM courses c WHERE c.organization_id = o.id) DESC,
                    (SELECT count(*) FROM class_sessions cs WHERE cs.organization_id = o.id) DESC,
                    o.created_at ASC
         ) AS position,
         count(*) OVER (PARTITION BY o.name) AS namesake_count
    FROM organizations o
   WHERE o.code <> 'PLATFORM'
)
DELETE FROM organizations o
  USING ranked r
  WHERE o.id = r.id
    AND r.namesake_count > 1
    AND r.position > 1
    AND o.code <> 'PLATFORM'
    AND NOT EXISTS (SELECT 1 FROM students s WHERE s.organization_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM courses c WHERE c.organization_id = o.id);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_name_key
  ON organizations (name);
