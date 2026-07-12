-- 0009_akira_extensions.sql: Mirror AKIRA extensions to D1

-- Phase 1 (Foundation Wave) — simhash for near-duplicate detection
ALTER TABLE news_cards ADD COLUMN simhash BIGINT NOT NULL DEFAULT 0;
CREATE INDEX idx_news_simhash ON news_cards(simhash);

-- Phase 2 — bias narrative columns on clusters
ALTER TABLE clusters ADD COLUMN bias_narrative TEXT;
ALTER TABLE clusters ADD COLUMN bias_key_quotes TEXT;
ALTER TABLE clusters ADD COLUMN bias_narrative_at TEXT;
ALTER TABLE clusters ADD COLUMN bias_narrative_model TEXT;
CREATE INDEX idx_clusters_narrative_at ON clusters(bias_narrative_at);

-- Phase 3 — credibility scoring columns on sources
ALTER TABLE sources ADD COLUMN credibility_score INTEGER DEFAULT 50;
ALTER TABLE sources ADD COLUMN retraction_count INTEGER DEFAULT 0;
ALTER TABLE sources ADD COLUMN uniqueness_ratio REAL DEFAULT 1.0;
ALTER TABLE sources ADD COLUMN diversity_score INTEGER DEFAULT 50;
ALTER TABLE sources ADD COLUMN credibility_updated_at TEXT;
CREATE INDEX idx_sources_credibility ON sources(credibility_score DESC);

-- Phase 4 — contradiction detection (numerical/factual disagreements
-- between sources in the same cluster). The detector runs inside
-- AKIRA's synthesis pipeline (core/contradiction_detector.py) and
-- writes the JSON payload + count + analysis timestamp here. The
-- frontend reads it via GET /api/clusters/:id/contradictions.
ALTER TABLE clusters ADD COLUMN contradictions_json TEXT;
ALTER TABLE clusters ADD COLUMN contradictions_at TEXT;
ALTER TABLE clusters ADD COLUMN contradictions_count INTEGER DEFAULT 0;
CREATE INDEX idx_clusters_contradictions_at ON clusters(contradictions_at);