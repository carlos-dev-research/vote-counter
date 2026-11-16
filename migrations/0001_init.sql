-- Initial schema. Do not edit after it has been applied; add 0002_*.sql instead.

CREATE TABLE campaigns (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  created_at  TEXT NOT NULL,
  opened_at   TEXT,
  closed_at   TEXT
);

CREATE TABLE categories (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_categories_campaign ON categories(campaign_id);

CREATE TABLE candidates (
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_candidates_category ON candidates(category_id);

CREATE TABLE votes (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  category_id   TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  candidate_id  TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  device_id     TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (category_id, device_id)   -- one vote per device per category
);
CREATE INDEX idx_votes_candidate ON votes(candidate_id);
CREATE INDEX idx_votes_campaign ON votes(campaign_id);
