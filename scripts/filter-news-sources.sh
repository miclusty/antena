#!/bin/bash
# Filtra leads.json para obtener sitios de noticias potenciales
# Genera seeds_candidates.json para validación por Scout

set -e

LEADS_FILE="${1:-leads.json}"
OUTPUT_FILE="seeds_candidates.json"

echo "🔍 Filtrando leads para encontrar noticias..."
echo ""

# Extraer solo dominios con keywords de noticias
# Excluir obviamente NO-noticias
jq -c '
  [.[] | 
    # Debe tener keyword de noticias
    select(.dominio | test("(diario|noticias|prensa|radio|fm|tv|televis|cronica|periodic|hora[^s]|elmundo|elpais|laopinion|laregion|lavoz|elciudadano|elsiglo|laire|elmunicipal|ahora|lup|minutuno|infobae|clarin|lanacion|pagina12|ambito|cronica|telefe|canal)" ; "i")) |
    
    # NO debe ser obviamente no-noticias
    select(.dominio | test("(hotel|restaur|clinic|abogado|consultor|venta|alquiler|seguro|inmobiliar|odontolog|veterinar|agencia|tienda|shop|store|cafe|bar[^a-z]|pizza|sushi|gym|fitness|yoga|mayorista|corp|sa$|srl$|marketing|publicidad)" ; "i") | not) |
    
    # NO debe ser gobierno (queremos independientes)
    select(.dominio | test("\\.gob\\.ar$") | not) |
    
    {
      url: ("https://" + .dominio),
      domain: .dominio,
      cms: (.cms // ""),
      source: "leads.json"
    }
  ] | unique_by(.domain) | sort_by(.domain)
' "$LEADS_FILE" > "$OUTPUT_FILE"

COUNT=$(jq 'length' "$OUTPUT_FILE")
echo "✅ $COUNT sitios candidatos filtrados → $OUTPUT_FILE"

echo ""
echo "📊 Distribución por tipo (basado en dominio):"
echo "   - Radios (fm/radio): $(jq -r '.[] | select(.domain | test("(fm|radio)"; "i")) | .domain' "$OUTPUT_FILE" | wc -l)"
echo "   - Diarios: $(jq -r '.[] | select(.domain | test("diario"; "i")) | .domain' "$OUTPUT_FILE" | wc -l)"
echo "   - Noticias: $(jq -r '.[] | select(.domain | test("noticias"; "i")) | .domain' "$OUTPUT_FILE" | wc -l)"
echo "   - TV: $(jq -r '.[] | select(.domain | test("(tv|televis)"; "i")) | .domain' "$OUTPUT_FILE" | wc -l)"
echo "   - Otros: $(jq 'length' "$OUTPUT_FILE") -以上"

echo ""
echo "📋 Muestra (primeros 20):"
jq -r '.[:20][] | .domain' "$OUTPUT_FILE"
