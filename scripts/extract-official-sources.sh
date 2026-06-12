#!/bin/bash
# Extract official government sources from Wikipedia
# Uses MiniMax web_search to find official sites for each location

set -e

DB_PATH="${AKIRA_DB_PATH:-$HOME/data/akira.db}"
API_KEY="${MINIMAX_API_KEY}"

echo "🏛️  Extracting official government sources..."
echo ""

# Get all locations from DB
LOCATIONS=$(sqlite3 "$DB_PATH" "SELECT id, name, province FROM locations ORDER BY population DESC;")

process_location() {
    local location_id=$1
    local city=$2
    local province=$3
    
    echo "📍 $city, $province"
    
    # Search for official government site
    QUERY="sitio oficial gobierno municipalidad $city $province Argentina"
    
    RESPONSE=$(curl -s "https://api.minimax.io/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $API_KEY" \
        -d "{
            \"model\": \"MiniMax-M2.7\",
            \"messages\": [{\"role\": \"user\", \"content\": \"Find the official government website for $city, $province, Argentina. Reply ONLY with the URL, or NONE if not found.\"}],
            \"max_tokens\": 100,
            \"temperature\": 0.1
        }" 2>/dev/null)
    
    # Extract URL from response
    URL=$(echo "$RESPONSE" | jq -r '.choices[0].message.content' 2>/dev/null | grep -oE 'https?://[^ ]+' | head -1)
    
    if [ -n "$URL" ] && [ "$URL" != "NONE" ]; then
        # Register official source
        sqlite3 "$DB_PATH" \
            "INSERT OR IGNORE INTO sources (name, url, location_id, type, is_active, notes)
             VALUES ('Municipalidad ${city}', '${URL}', ${location_id}, 'oficial', 1, 'Fuente oficial - gobierno')"
        echo "   ✅ $URL"
    else
        echo "   ⚠️ No encontrada"
    fi
}

# Process locations
echo "$LOCATIONS" | while IFS='|' read -r id name province; do
    process_location "$id" "$name" "$province"
done

echo ""
echo "=== FUENTES OFICIALES REGISTRADAS ==="
sqlite3 "$DB_PATH" "SELECT COUNT(*) as count FROM sources WHERE type = 'oficial';"
sqlite3 "$DB_PATH" "SELECT name, url FROM sources WHERE type = 'oficial' LIMIT 10;"
