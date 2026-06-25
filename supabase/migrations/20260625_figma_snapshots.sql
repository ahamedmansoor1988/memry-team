-- ─────────────────────────────────────────────────────────────────────────────
-- Figma Snapshot Architecture
-- Normalized snapshot tables so scanning never calls the Figma API.
-- Keeps figma_node_cache intact for backward compatibility.
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per sync run. Never overwrite — append-only for snapshot versioning.
CREATE TABLE IF NOT EXISTS figma_snapshots (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_key             text        NOT NULL,
  node_id              text        NOT NULL,
  frame_name           text,
  figma_version        text,
  synced_at            timestamptz NOT NULL DEFAULT now(),
  is_stale             boolean     NOT NULL DEFAULT false,
  depth_used           integer     NOT NULL DEFAULT 5,
  raw_node_count       integer,
  text_node_count      integer,
  color_node_count     integer,
  sync_duration_ms     integer,
  frame_bounds         jsonb
);

CREATE INDEX IF NOT EXISTS figma_snapshots_lookup_idx
  ON figma_snapshots (file_key, node_id, synced_at DESC)
  WHERE is_stale = false;

ALTER TABLE figma_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON figma_snapshots;
CREATE POLICY "service role full access" ON figma_snapshots USING (true) WITH CHECK (true);

-- ── snapshot_text: one row per TEXT node extracted from the frame ─────────────
CREATE TABLE IF NOT EXISTS snapshot_text (
  id              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid  NOT NULL REFERENCES figma_snapshots(id) ON DELETE CASCADE,
  node_id         text  NOT NULL,
  node_name       text,
  content         text,
  font_family     text,
  font_size       real,
  font_weight     integer,
  font_style      text,
  letter_spacing  real,
  line_height_px  real,
  text_align      text,
  fill_color      text,
  style_id        text,
  fill_style_id   text,
  bounds          jsonb,
  UNIQUE (snapshot_id, node_id)
);

CREATE INDEX IF NOT EXISTS snapshot_text_snap_idx ON snapshot_text (snapshot_id);

ALTER TABLE snapshot_text ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON snapshot_text;
CREATE POLICY "service role full access" ON snapshot_text USING (true) WITH CHECK (true);

-- ── snapshot_colors: fills / strokes / shadows on non-text nodes ──────────────
CREATE TABLE IF NOT EXISTS snapshot_colors (
  id               uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id      uuid  NOT NULL REFERENCES figma_snapshots(id) ON DELETE CASCADE,
  node_id          text  NOT NULL,
  node_name        text,
  node_type        text,
  fill_color_hex   text,
  fill_opacity     real,
  stroke_color_hex text,
  stroke_width     real,
  border_radius    real,
  shadow           text,
  bounds           jsonb,
  UNIQUE (snapshot_id, node_id)
);

CREATE INDEX IF NOT EXISTS snapshot_colors_snap_idx ON snapshot_colors (snapshot_id);

ALTER TABLE snapshot_colors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON snapshot_colors;
CREATE POLICY "service role full access" ON snapshot_colors USING (true) WITH CHECK (true);

-- ── qa_issues: internal issue database — replaces per-scan Figma comments ─────
-- Scanning writes here. Publishing reads and pushes to Figma only on demand.
CREATE TABLE IF NOT EXISTS qa_issues (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id          uuid        NOT NULL REFERENCES figma_snapshots(id) ON DELETE CASCADE,
  file_key             text        NOT NULL,
  node_id              text        NOT NULL,
  element              text        NOT NULL,
  category             text,
  issue                text        NOT NULL,
  severity             text        NOT NULL DEFAULT 'medium',
  live_url             text,
  scanned_at           timestamptz NOT NULL DEFAULT now(),
  published_at         timestamptz,
  figma_comment_id     text,
  figma_comment_offset jsonb
);

CREATE INDEX IF NOT EXISTS qa_issues_snap_idx ON qa_issues (snapshot_id);
CREATE INDEX IF NOT EXISTS qa_issues_unpublished_idx
  ON qa_issues (snapshot_id)
  WHERE figma_comment_id IS NULL;

ALTER TABLE qa_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON qa_issues;
CREATE POLICY "service role full access" ON qa_issues USING (true) WITH CHECK (true);
