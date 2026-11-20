-- Dati PERMANENTI (leggeri). Le posizioni GPS restano in Redis con scadenza 24 h.
CREATE TABLE IF NOT EXISTS accounts (
  id            text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('key','email')),
  key_hash      text UNIQUE,            -- sha256 della chiave personale
  email         text UNIQUE,            -- solo profili con email
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  confirmed_at  timestamptz,            -- ultima conferma (email)
  expires_at    timestamptz NOT NULL    -- calcolata dall'app (vedi regole)
);

CREATE TABLE IF NOT EXISTS races (
  id             text PRIMARY KEY,
  account_id     text REFERENCES accounts(id) ON DELETE CASCADE,
  admin_hash     text NOT NULL UNIQUE,  -- sha256 del link organizzatore
  name           text NOT NULL,
  starts_at      timestamptz,
  status         text NOT NULL DEFAULT 'draft',
  course         jsonb,                 -- tracciato GPX decimato
  created_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  expires_at     timestamptz            -- NULL = resta finché l'account esiste
);
CREATE INDEX IF NOT EXISTS races_account_idx ON races(account_id);
CREATE INDEX IF NOT EXISTS races_expires_idx ON races(expires_at);

CREATE TABLE IF NOT EXISTS checkpoints (
  race_id text NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  idx     int  NOT NULL,
  name    text NOT NULL,
  km      double precision NOT NULL,
  radius  int NOT NULL DEFAULT 50,
  PRIMARY KEY (race_id, idx)
);

CREATE TABLE IF NOT EXISTS participants (
  id              text PRIMARY KEY,
  race_id         text NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  name            text NOT NULL,
  consent_at      timestamptz,          -- prova del consenso (solo data/versione)
  consent_version text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS participants_race_idx ON participants(race_id);

CREATE TABLE IF NOT EXISTS passages (
  race_id        text NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  participant_id text NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  cp_idx         int  NOT NULL,
  t              timestamptz NOT NULL,
  PRIMARY KEY (participant_id, cp_idx)
);
