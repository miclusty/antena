#!/bin/bash
# Test Pipeline Completo - AKIRA
# Ejecuta: Harvester → Analyst → Cleaner → Publisher

set -e

DB_FILE=".wrangler/state/v3/d1/miniflare-D1DatabaseObject/8e8a3dabd670767f6418dd674222bdf51d4dd12ba4d21c3e90c6bfb084265bb6.sqlite"
LOG_FILE="/tmp/akira-pipeline-test.log"

echo "=========================================="
echo "🧪 AKIRA PIPELINE TEST"
echo "=========================================="
echo ""

# ============================================
# 1. VERIFICAR ESTADO INICIAL
# ============================================
echo "📊 ESTADO INICIAL:"
echo "-------------------"

TOTAL_BEFORE=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM news_cards;")
ANALYZED_BEFORE=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM news_cards WHERE bias_score IS NOT NULL;")
QUALITY_BEFORE=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM news_cards WHERE quality_score IS NOT NULL;")

echo "  Total noticias: $TOTAL_BEFORE"
echo "  Analizadas (bias): $ANALYZED_BEFORE"
echo "  Con calidad: $QUALITY_BEFORE"
echo ""

# ============================================
# 2. HARVESTER - Extraer noticias nuevas
# ============================================
echo "🚀 STEP 1: HARVESTER (Extracción)"
echo "-----------------------------------"

# Fuentes de prueba (feed de Córdoba)
SOURCES=(
  "https://www.lagaceta.com.ar/feed/"
  "https://www.elfinanciero.com.ar/arc/outboundfeeds/rss/?outputType=xml"
  "https://www.ambito.com/rss/"
)

EXTRACTED=0
for url in "${SOURCES[@]}"; do
  echo "  Extrayendo: $url"
  
  RESPONSE=$(curl -s -X POST "http://localhost:5000/extract" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$url\", \"source_id\": 1}" 2>/dev/null)
  
  SUCCESS=$(echo "$RESPONSE" | jq -r '.success' 2>/dev/null || echo "false")
  
  if [ "$SUCCESS" = "true" ]; then
    ITEM_COUNT=$(echo "$RESPONSE" | jq '.items | length' 2>/dev/null || echo "0")
    echo "    ✅ $ITEM_COUNT artículos extraídos"
    EXTRACTED=$((EXTRACTED + ITEM_COUNT))
  else
    echo "    ❌ Error en extracción"
  fi
done

echo ""
echo "  📦 Total extraídos: $EXTRACTED artículos"

# ============================================
# 3. ANALYST - Analizar bias de noticias nuevas
# ============================================
echo ""
echo "🧠 STEP 2: ANALYST (Análisis de sesgo)"
echo "----------------------------------------"

# Obtener noticias sin analizar
UNANALYZED=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM news_cards WHERE bias_score IS NULL;")
echo "  Noticias sin analizar: $UNANALYZED"

if [ "$UNANALYZED" -gt 0 ]; then
  echo "  Analizando hasta 5 noticias de ejemplo..."
  
  sqlite3 "$DB_FILE" "SELECT id, title, url, body FROM news_cards WHERE bias_score IS NULL LIMIT 5;" | while IFS='|' read -r id title url body; do
    echo ""
    echo "  📰 [$id] ${title:0:60}..."
    
    # Análisis con el bias-analyzer local
    RESULT=$(node -e "
      const { analyzeBias } = require('./packages/api/dist/lib/bias-analyzer.js');
      const text = \`${body:-$title}\`;
      const result = analyzeBias(text, '$url', '$title');
      console.log(JSON.stringify(result));
    " 2>/dev/null || echo '{"error": "Module not compiled"}')
    
    if echo "$RESULT" | jq -e '.bias_score' >/dev/null 2>&1; then
      BIAS_SCORE=$(echo "$RESULT" | jq -r '.bias_score')
      BIAS_TYPE=$(echo "$RESULT" | jq -r '.bias_type')
      echo "    🎯 Bias: $BIAS_SCORE ($BIAS_TYPE)"
      
      # Actualizar en D1
      sqlite3 "$DB_FILE" "UPDATE news_cards SET bias_score = $BIAS_SCORE, bias_type = '$BIAS_TYPE' WHERE id = $id;"
    else
      echo "    ⚠️  Análisis no disponible (compilar primero)"
    fi
  done
fi

# ============================================
# 4. CLEANER - Filtrar gacetillas y spam
# ============================================
echo ""
echo "🧹 STEP 3: CLEANER (Filtrado de calidad)"
echo "------------------------------------------"

# Detectar gacetillas (noticias pagadas)
GACETILLA_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM news_cards WHERE is_gacetilla = 1;")
LOW_QUALITY=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM news_cards WHERE quality_score < 0.3;")

echo "  Gacetillas detectadas: $GACETILLA_COUNT"
echo "  Baja calidad (<0.3): $LOW_QUALITY"

# Actualizar calidad de noticias recientes
sqlite3 "$DB_FILE" "
UPDATE news_cards 
SET quality_score = CASE 
  WHEN body IS NULL OR length(body) < 100 THEN 0.2
  WHEN body LIKE '%gacetilla%' OR body LIKE '%publicidad%' THEN 0.1
  WHEN length(body) > 500 THEN 0.8
  ELSE 0.5
END
WHERE quality_score IS NULL;
"
echo "  ✅ Calidad actualizada"

# ============================================
# 5. RESULTADOS FINALES
# ============================================
echo ""
echo "📊 RESULTADOS FINALES:"
echo "----------------------"

TOTAL_AFTER=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM news_cards;")
ANALYZED_AFTER=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM news_cards WHERE bias_score IS NOT NULL;")
QUALITY_AFTER=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM news_cards WHERE quality_score IS NOT NULL;")
HIGH_QUALITY=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM news_cards WHERE quality_score >= 0.7;")

echo "  Total noticias: $TOTAL_BEFORE → $TOTAL_AFTER"
echo "  Analizadas (bias): $ANALYZED_BEFORE → $ANALYZED_AFTER"
echo "  Con calidad: $QUALITY_BEFORE → $QUALITY_AFTER"
echo "  Alta calidad (≥0.7): $HIGH_QUALITY"
echo ""

# Distribución de sesgo
echo "📈 DISTRIBUCIÓN DE SESGO:"
sqlite3 "$DB_FILE" "
SELECT 
  CASE 
    WHEN bias_score < 0.3 THEN '🔵 Izquierda'
    WHEN bias_score < 0.45 THEN '🟢 Centro-Izquierda'
    WHEN bias_score < 0.55 THEN '⚪ Centro'
    WHEN bias_score < 0.7 THEN '🟡 Centro-Derecha'
    ELSE '🔴 Derecha'
  END as tipo,
  COUNT(*) as cantidad,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM news_cards WHERE bias_score IS NOT NULL), 1) || '%' as porcentaje
FROM news_cards 
WHERE bias_score IS NOT NULL
GROUP BY tipo
ORDER BY cantidad DESC;
"

echo ""
echo "=========================================="
echo "✅ TEST COMPLETADO"
echo "=========================================="
