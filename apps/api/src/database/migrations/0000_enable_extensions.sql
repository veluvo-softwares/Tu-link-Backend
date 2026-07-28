-- Custom SQL migration file, put your code below! --

-- PostGIS provides the geography(Point,4326) type used by journeys/locations/
-- lag_alerts. pg_trgm backs the gin trigram indexes for user search (replaces
-- the Firestore  prefix trick). These must exist before the tables in
-- the next migration are created. Drizzle does not auto-create extensions.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
