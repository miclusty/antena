/**
 * Batch Bias Analyzer v3 - Usa archivo SQL temporal para evitar problemas de escaping
 * 
 * Uso: npx tsx scripts/batch-analyze-bias-v3.ts [limit]
 */

import { analyzeBias } from '../packages/api/src/lib/bias-analyzer';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DB_FILE = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/8e8a3dabd670767f6418dd674222bdf51d4dd12ba4d21c3e90c6bfb084265bb6.sqlite';
const CHUNK_SIZE = 500;
const SQL_FILE = path.join('/tmp', 'akira-bias-updates.sql');

function query(sql: string): string {
  return execSync(`sqlite3 "${DB_FILE}" "${sql}"`).toString().trim();
}

function runBatch(updates: string[]) {
  if (updates.length === 0) return;
  
  // Escribir archivo SQL
  fs.writeFileSync(SQL_FILE, updates.join('\n') + '\n');
  
  try {
    execSync(`sqlite3 "${DB_FILE}" < "${SQL_FILE}"`);
  } catch (e: any) {
    // Ignorar errores de batch
  }
}

function escapeSql(str: string): string {
  return str.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

// Obtener total sin analizar
const totalPending = parseInt(query("SELECT COUNT(*) FROM news_cards WHERE bias_score IS NULL OR bias_score = 0;"));
const userLimit = parseInt(process.argv[2] || '0') || totalPending;
const toProcess = Math.min(userLimit, totalPending);

console.log(`\n🧠 BATCH BIAS ANALYZER v3`);
console.log(`========================`);
console.log(`📊 Pendientes: ${totalPending}`);
console.log(`📦 A procesar: ${toProcess}`);
console.log(`\n⏳ Procesando...\n`);

// Cargar source map
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
let sqlUpdates: string[] = [];

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
      
      // Track distribution
      if (result.bias_score < 0.25) distribution.izquierda++;
      else if (result.bias_score < 0.42) distribution.centroIzq++;
      else if (result.bias_score < 0.58) distribution.centro++;
      else if (result.bias_score < 0.75) distribution.centroDer++;
      else distribution.derecha++;
      
      // Crear UPDATE SQL con escaping seguro
      const safeReasoning = escapeSql(JSON.stringify({
        source: result.source_score,
        framing: result.framing_score,
        entities: result.entity_score,
        signals: result.signals_used
      }).slice(0, 400));
      
      const safeId = escapeSql(id);
      
      sqlUpdates.push(`UPDATE news_cards SET bias_score = ${result.bias_score}, bias_reasoning = '${safeReasoning}' WHERE id = '${safeId}';`);
      
      processed++;
      
      // Ejecutar en batches de 100
      if (sqlUpdates.length >= 100) {
        runBatch(sqlUpdates);
        sqlUpdates = [];
      }
    } catch (e: any) {
      errors++;
    }
  }
  
  // Ejecutar updates pendientes del chunk
  if (sqlUpdates.length > 0) {
    runBatch(sqlUpdates);
    sqlUpdates = [];
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
console.log(`⏱️  Tiempo: ${elapsed.toFixed(1)}s`);
console.log(`⚡ Velocidad: ${(processed / elapsed).toFixed(0)} items/s`);

console.log(`\n📊 DISTRIBUCIÓN:`);
const total = processed || 1;
console.log(`  🔵 Izquierda: ${distribution.izquierda} (${(distribution.izquierda / total * 100).toFixed(1)}%)`);
console.log(`  🟢 Centro-Izq: ${distribution.centroIzq} (${(distribution.centroIzq / total * 100).toFixed(1)}%)`);
console.log(`  ⚪ Centro: ${distribution.centro} (${(distribution.centro / total * 100).toFixed(1)}%)`);
console.log(`  🟡 Centro-Der: ${distribution.centroDer} (${(distribution.centroDer / total * 100).toFixed(1)}%)`);
console.log(`  🔴 Derecha: ${distribution.derecha} (${(distribution.derecha / total * 100).toFixed(1)}%)`);
