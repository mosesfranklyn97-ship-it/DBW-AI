-- Version history needs the whole schema stored per revision: a summary is
-- enough to display, but it cannot be turned back into a schema, and the
-- project row only ever holds the newest one. Nullable so the revisions that
-- already exist keep working.
ALTER TABLE "revisions" ADD COLUMN "snapshot" jsonb;