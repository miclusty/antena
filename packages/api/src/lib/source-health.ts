/**
 * AKIRA - Source Health Tracking
 * Tracks which extraction methods work for each source
 * Learns from successes/failures to optimize future extractions
 *
 * IMPORTANT: This module uses better-sqlite3 (Node.js only).
 * In Cloudflare Workers, it degrades gracefully to a no-op stub.
 * Always wrap calls in try/catch when calling from extraction code.
 */

interface SourceHealth {
  source_id: number;
  last_success_at?: string;
  last_failure_at?: string;
  last_success_method?: string;
  last_error?: string;
  consecutive_failures: number;
  total_requests: number;
  successful_requests: number;
  success_count: Record<string, number>;
  avg_response_time_ms: number;
  is_circuit_open: boolean;
  should_retry_at?: string;
}

interface HealthUpdate {
  last_error?: string;
  consecutive_failures?: number;
  is_circuit_open?: boolean;
}

// Lazy-loaded database handle and type
type Database = import('better-sqlite3').Database;
let db: Database | null = null;
let DatabaseCls: any = null;
let dbOk = false;

function isWorkers(): boolean {
  // Cloudflare Workers exposes `globalThis.navigator`, Node.js does not (natively)
  return typeof globalThis.navigator !== 'undefined' && typeof (globalThis.navigator as any).userAgent === 'undefined';
}

async function getDb(): Promise<Database | null> {
  if (isWorkers()) {
    // Workers: D1 is accessed via env.DB, not better-sqlite3
    // Return null to signal "use D1-based health" — handled by caller
    return null;
  }

  if (dbOk) return db;

  try {
    // Dynamic import so bundlers don't try to bundle this for Workers
    const mod = await import('better-sqlite3');
    DatabaseCls = mod.default;
    const DB_PATH = process.env.AKIRA_DB_PATH || `${process.env.HOME}/data/akira.db`;
    db = new DatabaseCls(DB_PATH);
    (db as any).pragma('journal_mode = WAL');
    initHealthTable(db!);
    dbOk = true;
    return db;
  } catch (err) {
    console.warn('[source-health] better-sqlite3 unavailable, health tracking disabled:', (err as Error).message);
    dbOk = false;
    return null;
  }
}

function initHealthTable(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS source_health (
      source_id INTEGER PRIMARY KEY,
      last_success_at DATETIME,
      last_failure_at DATETIME,
      last_success_method TEXT,
      last_error TEXT,
      consecutive_failures INTEGER DEFAULT 0,
      total_requests INTEGER DEFAULT 0,
      successful_requests INTEGER DEFAULT 0,
      success_count_json TEXT DEFAULT '{}',
      avg_response_time_ms REAL DEFAULT 0,
      is_circuit_open BOOLEAN DEFAULT 0,
      circuit_opened_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );

    CREATE INDEX IF NOT EXISTS idx_source_health_circuit ON source_health(is_circuit_open);
    CREATE INDEX IF NOT EXISTS idx_source_health_failures ON source_health(consecutive_failures);
  `);
}

/**
 * Get health info for a source
 */
export async function getSourceHealth(sourceId: number): Promise<SourceHealth | null> {
  const database = await getDb();
  if (!database) return null;

  const row = database.prepare(`
    SELECT * FROM source_health WHERE source_id = ?
  `).get(sourceId) as any;

  if (!row) return null;

  return {
    source_id: row.source_id,
    last_success_at: row.last_success_at,
    last_failure_at: row.last_failure_at,
    last_success_method: row.last_success_method,
    last_error: row.last_error,
    consecutive_failures: row.consecutive_failures,
    total_requests: row.total_requests,
    successful_requests: row.successful_requests,
    success_count: JSON.parse(row.success_count_json || '{}'),
    avg_response_time_ms: row.avg_response_time_ms,
    is_circuit_open: row.is_circuit_open === 1,
    should_retry_at: row.circuit_opened_at
  };
}

/**
 * Record an extraction attempt
 */
export async function recordExtraction(
  sourceId: number,
  method: string,
  success: boolean,
  responseTimeMs?: number
): Promise<void> {
  const database = await getDb();
  if (!database) return;

  const now = new Date().toISOString();

  // Get current health
  const current = await getSourceHealth(sourceId);
  const successCount = current?.success_count ?? {};

  if (success) {
    successCount[method] = (successCount[method] || 0) + 1;
  }

  // Calculate new average response time
  const newTotal = (current?.total_requests ?? 0) + 1;
  const currentAvg = current?.avg_response_time_ms ?? 0;
  const newAvg = responseTimeMs
    ? (currentAvg * (newTotal - 1) + responseTimeMs) / newTotal
    : currentAvg;

  database.prepare(`
    INSERT INTO source_health (
      source_id,
      last_success_at,
      last_failure_at,
      last_success_method,
      last_error,
      consecutive_failures,
      total_requests,
      successful_requests,
      success_count_json,
      avg_response_time_ms,
      is_circuit_open,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      last_success_at = COALESCE(?, last_success_at),
      last_failure_at = COALESCE(?, last_failure_at),
      last_success_method = COALESCE(?, last_success_method),
      last_error = ?,
      consecutive_failures = ?,
      total_requests = ?,
      successful_requests = ?,
      success_count_json = ?,
      avg_response_time_ms = ?,
      is_circuit_open = ?,
      updated_at = ?
  `).run(
    sourceId,
    success ? now : null,
    success ? null : now,
    success ? method : null,
    null,
    success ? 0 : ((current?.consecutive_failures ?? 0) + 1),
    newTotal,
    (current?.successful_requests ?? 0) + (success ? 1 : 0),
    JSON.stringify(successCount),
    Math.round(newAvg),
    success ? 0 : (newTotal > 10 && ((current?.consecutive_failures ?? 0) + 1) >= 5) ? 1 : 0,
    now,
    // For ON CONFLICT
    success ? now : null,
    success ? null : now,
    success ? method : null,
    null,
    success ? 0 : ((current?.consecutive_failures ?? 0) + 1),
    newTotal,
    (current?.successful_requests ?? 0) + (success ? 1 : 0),
    JSON.stringify(successCount),
    Math.round(newAvg),
    success ? 0 : (newTotal > 10 && ((current?.consecutive_failures ?? 0) + 1) >= 5) ? 1 : 0,
    now
  );
}

/**
 * Update source health with error info
 */
export async function updateSourceHealth(
  sourceId: number,
  updates: HealthUpdate
): Promise<void> {
  const database = await getDb();
  if (!database) return;

  const current = await getSourceHealth(sourceId);
  if (!current) return;

  database.prepare(`
    UPDATE source_health
    SET
      last_error = COALESCE(?, last_error),
      last_failure_at = datetime('now'),
      consecutive_failures = COALESCE(?, consecutive_failures),
      is_circuit_open = COALESCE(?, is_circuit_open),
      circuit_opened_at = CASE WHEN ? = 1 THEN datetime('now') ELSE circuit_opened_at END,
      updated_at = datetime('now')
    WHERE source_id = ?
  `).run(
    updates.last_error ?? null,
    updates.consecutive_failures ?? null,
    updates.is_circuit_open ?? null,
    updates.is_circuit_open ?? 0,
    sourceId
  );
}

/**
 * Get sources that need attention
 */
export async function getProblematicSources(): Promise<SourceHealth[]> {
  const database = await getDb();
  if (!database) return [];

  const rows = database.prepare(`
    SELECT * FROM source_health
    WHERE consecutive_failures >= 3
       OR is_circuit_open = 1
       OR last_success_at < datetime('now', '-24 hours')
    ORDER BY consecutive_failures DESC
    LIMIT 50
  `).all() as any[];

  return rows.map(row => ({
    source_id: row.source_id,
    last_success_at: row.last_success_at,
    last_failure_at: row.last_failure_at,
    last_success_method: row.last_success_method,
    last_error: row.last_error,
    consecutive_failures: row.consecutive_failures,
    total_requests: row.total_requests,
    successful_requests: row.successful_requests,
    success_count: JSON.parse(row.success_count_json || '{}'),
    avg_response_time_ms: row.avg_response_time_ms,
    is_circuit_open: row.is_circuit_open === 1
  }));
}

/**
 * Get reliability score for a source (0.0 - 1.0)
 */
export async function getReliabilityScore(sourceId: number): Promise<number> {
  const health = await getSourceHealth(sourceId);

  if (!health || health.total_requests === 0) return 0.5; // Unknown = neutral

  const successRate = health.successful_requests / health.total_requests;

  // Penalize recent failures
  const failurePenalty = Math.min(health.consecutive_failures * 0.1, 0.5);

  // Boost if diverse methods work
  const methodDiversity = Object.keys(health.success_count).length / 4; // max 4 methods
  const diversityBonus = methodDiversity * 0.1;

  return Math.max(0, Math.min(1, successRate - failurePenalty + diversityBonus));
}

/**
 * Reset circuit for a source (manual intervention)
 */
export async function resetCircuit(sourceId: number): Promise<void> {
  const database = await getDb();
  if (!database) return;

  database.prepare(`
    UPDATE source_health
    SET
      is_circuit_open = 0,
      consecutive_failures = 0,
      updated_at = datetime('now')
    WHERE source_id = ?
  `).run(sourceId);
}
