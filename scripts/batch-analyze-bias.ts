/**
 * Batch Bias Analyzer - Procesa todas las noticias sin bias_score
 * 
 * Uso: npx tsx scripts/batch-analyze-bias.ts [limit]
 * Sin limit: procesa todas
 * Con limit: procesa N noticias
 */

import { analyzeBias } from '../packages/api/src/lib/bias-analyzer';
import { execSync } from 'child_process';

const DB_FILE = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/8e8a3dabd670767f6418dd674222bdf51d4dd12ba4d21c3e90c6bfb084265bb6.sqlite';

function query(sql: string): string {
  return execSync(`sqlite3 "${DB_FILE}" "${sql}"`).toString().trim();
}

function run(sql: string) {
  execSync(`sqlite3 "${DB_FILE}" "${sql}"`);
}

// Obtener total sin analizar
const totalPending = parseInt(query("SELECT COUNT(*) FROM news_cards WHERE bias_score IS NULL OR bias_score = 0;"));
const limit = parseInt(process.argv[2] || '0') || totalPending;

console.log(`\n🧠 BATCH BIAS ANALYZER`);
console.log(`=====================`);
console.log(`📊 Pendientes: ${totalPending}`);
console.log(`📦 A procesar: ${Math.min(limit, totalPending)}`);
console.log(`\n⏳ Procesando...\n`);

// Obtener noticias con source_ids para mapear a fuentes
const rows = query(`
  SELECT id, title, COALESCE(body, summary, '') as text, source_ids 
  FROM news_cards 
  WHERE bias_score IS NULL OR bias_score = 0 
  LIMIT ${Math.min(limit, totalPending)};
`).split('\n').filter(line => line.includes('|'));

// Mapear source_ids a URLs de fuentes
const sourceMap: Record<string, string> = {};
const sourcesData = query(`SELECT id, url FROM sources WHERE url IS NOT NULL AND url != '';`);
sourcesData.split('\n').filter(l => l.includes('|')).forEach(line => {
  const [id, url] = line.split('|');
  sourceMap[id] = url;
});

let processed = 0;
let errors = 0;
let results: any[] = [];

const startTime = Date.now();

for (const line of rows) {
  const parts = line.split('|');
  const id = parts[0];
  const title = parts[1] || '';
  const text = parts[2] || '';
  const sourceIds = parts[3] || '';
  
  try {
    // Buscar URL de la fuente
    let sourceUrl = 'https://desconocido.com.ar';
    if (sourceIds) {
      // source_ids puede ser "1,2,3" o similar
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
    
    // Escapar para SQL
    const safeType = result.bias_type.replace(/'/g, "''").slice(0, 50);
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
    
    results.push(result);
    processed++;
    
    if (processed % 100 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const eta = (totalPending - processed) / rate;
      console.log(`  ✅ ${processed}/${Math.min(limit, totalPending)} | ${rate.toFixed(0)} items/s | ETA: ${eta.toFixed(0)}s`);
    }
  } catch (e: any) {
    errors++;
    if (errors <= 5) {
      console.log(`  ❌ Error en ${id}: ${e.message.slice(0, 80)}`);
    }
  }
}

const elapsed = (Date.now() - startTime) / 1000;

console.log(`\n✅ COMPLETADO`);
console.log(`=====================`);
console.log(`📦 Procesadas: ${processed}`);
console.log(`❌ Errores: ${errors}`);
console.log(`⏱️  Tiempo: ${elapsed.toFixed(1)}s`);
console.log(`⚡ Velocidad: ${(processed / elapsed).toFixed(0)} items/s`);

// Estadísticas
if (results.length > 0) {
  const avg = results.reduce((sum, r) => sum + r.bias_score, 0) / results.length;
  
  const distribution = { izquierda: 0, centroIzq: 0, centro: 0, centroDer: 0, derecha: 0 };
  for (const r of results) {
    if (r.bias_score < 0.25) distribution.izquierda++;
    else if (r.bias_score < 0.42) distribution.centroIzq++;
    else if (r.bias_score < 0.58) distribution.centro++;
    else if (r.bias_score < 0.75) distribution.centroDer++;
    else distribution.derecha++;
  }
  
  console.log(`\n📊 DISTRIBUCIÓN:`);
  console.log(`  🔵 Izquierda: ${distribution.izquierda} (${(distribution.izquierda / results.length * 100).toFixed(1)}%)`);
  console.log(`  🟢 Centro-Izq: ${distribution.centroIzq} (${(distribution.centroIzq / results.length * 100).toFixed(1)}%)`);
  console.log(`  ⚪ Centro: ${distribution.centro} (${(distribution.centro / results.length * 100).toFixed(1)}%)`);
  console.log(`  🟡 Centro-Der: ${distribution.centroDer} (${(distribution.centroDer / results.length * 100).toFixed(1)}%)`);
  console.log(`  🔴 Derecha: ${distribution.derecha} (${(distribution.derecha / results.length * 100).toFixed(1)}%)`);
  console.log(`  📈 Score promedio: ${avg.toFixed(2)}`);
  
  // Ejemplos
  console.log(`\n📰 EJEMPLOS:`);
  const sorted = [...results].sort((a, b) => a.bias_score - b.bias_score);
  console.log(`  Más izquierda: ${sorted[0]?.bias_score} - ${sorted[0]?.bias_type}`);
  console.log(`  Más centro: ${sorted[Math.floor(sorted.length / 2)]?.bias_score} - ${sorted[Math.floor(sorted.length / 2)]?.bias_type}`);
  console.log(`  Más derecha: ${sorted[sorted.length - 1]?.bias_score} - ${sorted[sorted.length - 1]?.bias_type}`);
}
