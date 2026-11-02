-- Consolidate organizations.
--
-- Earlier versions inserted the default organization on every migration run
-- because `organizations.name` was not unique.  That produced several empty
-- organizations (and duplicate demo accounts, one per organization).  Login
-- looks users up by email, so an arbitrary stale account could be selected.
--
-- Keep the organization that actually owns data (falling back to the oldest
-- one), delete the empty duplicates, then prevent the situation from repeating.

WITH ranked AS (
  SELECT o.id,
         ROW_NUMBER() OVER (
           ORDER BY (SELECT count(*) FROM students s WHERE s.organization_id = o.id) DESC,
                    (SELECT count(*) FROM courses c WHERE c.organization_id = o.id) DESC,
                    (SELECT count(*) FROM class_sessions cs WHERE cs.organization_id = o.id) DESC,
                    o.created_at ASC
         ) AS position
    FROM organizations o
)
DELETE FROM organizations o
 USING ranked r
 WHERE o.id = r.id
   AND r.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_name_key
  ON organizations (name);
