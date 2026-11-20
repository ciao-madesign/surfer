-- Archivio di fine gara: solo tempi e statistiche (la traccia GPS completa resta su Redis, 24 h).
ALTER TABLE races ALTER COLUMN admin_hash DROP NOT NULL;
ALTER TABLE races ADD COLUMN IF NOT EXISTS started_at  timestamptz;
ALTER TABLE races ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE races ADD COLUMN IF NOT EXISTS total_km    double precision;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS stats jsonb;
