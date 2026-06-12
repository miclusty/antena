/**
 * Batch Bias Analyzer v2 - Procesa en chunks para evitar buffer overflow
 * 
 * Uso: npx tsx scripts/batch-analyze-bias-v2.ts [limit]
 */

import { analyzeBias } from '../packages/api/src/lib/bias-analyzer';
import { execSync } from 'child_process';

const DB_FILE = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/8e8a3dabd670767f6418dd674222bdf51d4dd12ba4d21c3e90c6bfb084265bb6.sqlite';
const CHUNK_SIZE = 500;

function query(sql: string): string {
  return execSync(`sqlite3 "${DB_FILE}" "${sql}"`).toString().trim();
}

function run(sql: string) {
  execSync(`sqlite3 "${DB_FILE}" "${sql}"`);
}

// Obtener total sin analizar
const totalPending = parseInt(query("SELECT COUNT(*) FROM news_cards WHERE bias_score IS NULL OR bias_score = 0;"));
const userLimit = parseInt(process.argv[2] || '0') || totalPending;
const toProcess = Math.min(userLimit, totalPending);

console.log(`\n🧠 BATCH BIAS ANALYZER v2`);
console.log(`========================`);
console.log(`📊 Pendientes: ${totalPending}`);
console.log(`📦 A procesar: ${toProcess}`);
console.log(`📦 Chunk size: ${CHUNK_SIZE}`);
console.log(`📦 Chunks: ${Math.ceil(toProcess / CHUNK_SIZE)}`);
console.log(`\n⏳ Procesando...\n`);

// Cargar source map una sola vez
const sourceMap: Record<string, string> = {};
const sourcesData = query(`SELECT id, url FROM sources WHERE url IS NOT NULL AND url != '';`);
sourcesData.split('\n').filter(l => l.includes('|')).forEach(line => {
  const [id, url] = line.split('|');
  sourceMap[id] = url;
});

let processed = 0;
let errors = 0;
const distribution = { izquierda: 0, centroIzq: 0, centro: 0, centroDer: 0, derecha: 0 };
const startTime = Date.now();

// Procesar en chunks
for (let offset = 0; offset < toProcess; offset += CHUNK_SIZE) {
  const limit = Math.min(CHUNK_SIZE, toProcess - offset);
  
  const chunkData = query(`
    SELECT id, title, COALESCE(body, summary, '') as text, source_ids 
    FROM news_cards 
    WHERE bias_score IS NULL OR bias_score = 0 
    LIMIT ${limit} OFFSET ${offset};
  `);
  
  const rows = chunkData.split('\n').filter(line => line.includes('|'));
  
  for (const line of rows) {
    const parts = line.split('|');
    const id = parts[0];
    const title = parts[1] || '';
    const text = parts[2] || '';
    const sourceIds = parts[3] || '';
    
    try {
      let sourceUrl = 'https://desconocido.com.ar';
      if (sourceIds) {
        const ids = sourceIds.split(',');
        for (const sid of ids) {
          const trimmed = sid.trim();
          if (sourceMap[trimmed]) {
            sourceUrl = sourceMap[trimmed];
            break;
          }
        }
      }
      
      const result = analyzeBias(text, sourceUrl, title);
      
      const safeReasoning = JSON.stringify({
        source: result.source_score,
        framing: result.framing_score,
        entities: result.entity_score,
        indicators: {
          right: result.right_indicators.slice(0, 3),
          left: result.left_indicators.slice(0, 3)
        },
        signals: result.signals_used
      }).replace(/'/g, "''").slice(0, 500);
      
      run(`UPDATE news_cards SET bias_score = ${result.bias_score}, bias_reasoning = '${safeReasoning}' WHERE id = '${id.replace(/'/g, "''")}';`);
      
      // Track distribution
      if (result.bias_score < 0.25) distribution.izquierda++;
      else if (result.bias_score < 0.42) distribution.centroIzq++;
      else if (result.bias_score < 0.58) distribution.centro++;
      else if (result.bias_score < 0.75) distribution.centroDer++;
      else distribution.derecha++;
      
      processed++;
    } catch (e: any) {
      errors++;
    }
  }
  
  // Progress
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = processed / elapsed;
  const remaining = toProcess - processed;
  const eta = remaining / rate;
  
  console.log(`  ✅ ${processed}/${toProcess} (${(processed / toProcess * 100).toFixed(1)}%) | ${rate.toFixed(0)} items/s | ETA: ${eta.toFixed(0)}s`);
}

const elapsed = (Date.now() - startTime) / 1000;

console.log(`\n✅ COMPLETADO`);
console.log(`========================`);
console.log(`📦 Procesadas: ${processed}`);
console.log(`❌ Errores: ${errors}`);
console.log(`⏱️  Tiempo: ${elapsed.toFixed(1)}s (${(elapsed / 60).toFixed(1)} min)`);
console.log(`⚡ Velocidad: ${(processed / elapsed).toFixed(0)} items/s`);

console.log(`\n📊 DISTRIBUCIÓN:`);
const total = processed || 1;
console.log(`  🔵 Izquierda: ${distribution.izquierda} (${(distribution.izquierda / total * 100).toFixed(1)}%)`);
console.log(`  🟢 Centro-Izq: ${distribution.centroIzq} (${(distribution.centroIzq / total * 100).toFixed(1)}%)`);
console.log(`  ⚪ Centro: ${distribution.centro} (${(distribution.centro / total * 100).toFixed(1)}%)`);
console.log(`  🟡 Centro-Der: ${distribution.centroDer} (${(distribution.centroDer / total * 100).toFixed(1)}%)`);
console.log(`  🔴 Derecha: ${distribution.derecha} (${(distribution.derecha / total * 100).toFixed(1)}%)`);
