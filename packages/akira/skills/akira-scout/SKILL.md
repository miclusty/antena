---
name: akira-scout
description: Discovers Argentine news sources with intelligent rotation using official government locality dataset (cp.json). Rotates through provinces → cities → deep search without repeating. Uses MiniMax MCP web_search + AKIRA API validation. Writes to unified akira.db.
version: 11.0.0
author: AKIRA
license: MIT
metadata:
  hermes:
    tags: [akira, news, argentina, scout, minimax-mcp, web-search, discovery, rotation, stateful, cp-json]
    related_skills: [akira-harvester]
---

# AKIRA Scout Agent v11.0 — Intelligent Rotation with Official Dataset

Discovers Argentine news sources using the **official government locality dataset** (4,037 localities from apis.datos.gob.ar) with **stateful intelligent rotation** — never repeats, always targets uncovered areas.

## Data Sources

```bash
AKIRA_DB="/Users/omatic/proyectos/news/packages/akira/data/akira.db"
STATE_FILE="/Users/omatic/.hermes/scout_state.json"
CP_JSON="/Users/omatic/proyectos/news/data/cp.json"
```

The `cp.json` file contains **4,037 official Argentine localities** from the government Georef API, with:
- `id`: Official INDEC identifier
- `nombre`: Locality name
- `provincia`: Province name
- `departamento`: Department name
- `municipio`: Municipality name
- `categoria`: Category (Entidad, Localidad simple, etc.)
- `lat`, `lon`: Coordinates

## Tools Used

- **MiniMax MCP `web_search`** — Web search via `minimax-coding-plan-mcp`
  - Tool name: `web_search`
  - Parameter: `query` (string)
  - Returns: JSON with `organic` results (title, link, snippet, date)
- **Terminal** — For curl, sqlite3, python3, validation
- **File** — For reading cp.json and state

## Pre-flight Check

```bash
# 1. Verify AKIRA running
curl -s http://localhost:5000/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('AKIRA:', d['status'])"

# 2. Verify DB accessible
python3 -c "import sqlite3; c=sqlite3.connect('/Users/omatic/proyectos/news/packages/akira/data/akira.db'); print('Sources:', c.execute('SELECT COUNT(*) FROM sources WHERE is_active=1').fetchone()[0])"

# 3. Verify cp.json exists
python3 -c "import json; d=json.load(open('/Users/omatic/proyectos/news/data/cp.json')); print(f'Localities: {len(d)}')"
```

## State File Initialization

The `STATE_FILE` (`/Users/omatic/.hermes/scout_state.json`) **auto-initializes if missing** — no manual setup needed. The initialization happens in Step 1 of the workflow above:

```python
if [ ! -f "$STATE_FILE" ]; then
  # Creates state with phase='province', all indexes = -1
  # Then advances to phase='city' after all provinces done
  # Then advances to phase='deep' after all cities done
fi
```

**If state file is corrupted or you want to reset:**
```bash
python3 -c "
import json
state = {
    'phase': 'province',
    'province_idx': -1,
    'city_idx': -1,
    'deep_idx': -1,
    'last_run': '',
    'total_runs': 0,
    'phase_history': {
        'province': {'completed': 0, 'total': 24},
        'city': {'completed': 0, 'total': 4037},
        'deep': {'completed': 0, 'total': 10}
    }
}
json.dump(state, open('/Users/omatic/.hermes/scout_state.json', 'w'), indent=2)
print('State reset to province phase')
"
```

**Verify current state at any time:**
```bash
python3 -c "import json; s=json.load(open('/Users/omatic/.hermes/scout_state.json')); print(f\"Phase: {s['phase']} | Province: {s['province_idx']+1}/24 | City: {s['city_idx']+1}/4037 | Deep: {s['deep_idx']+1}/10\")"
```

## Rotation Strategy (3 Phases)

```
Phase 1: PROVINCES (24 targets)
  → Priority: fewest sources first
  → 5 search queries per province
  → Register new sources found

Phase 2: CITIES (4,037 targets from cp.json)
  → Priority: fewest sources first, then population
  → 3 search queries per city
  → Register new sources found

Phase 3: DEEP SEARCH (niche sources)
  → Radio stations, TV channels, podcasts
  → Specialized media (sports, economy, culture)
  → Regional aggregators
```

## Workflow

### Step 1: Load state

```bash
STATE_FILE="/Users/omatic/.hermes/scout_state.json"
AKIRA_DB="/Users/omatic/proyectos/news/packages/akira/data/akira.db"
CP_JSON="/Users/omatic/proyectos/news/data/cp.json"

# Initialize state if missing
if [ ! -f "$STATE_FILE" ]; then
  python3 -c "
import json
state = {
    'phase': 'province',
    'province_idx': -1,
    'city_idx': -1,
    'deep_idx': -1,
    'last_run': '',
    'total_runs': 0,
    'phase_history': {
        'province': {'completed': 0, 'total': 24},
        'city': {'completed': 0, 'total': 4037},
        'deep': {'completed': 0, 'total': 10}
    }
}
json.dump(state, open('$STATE_FILE', 'w'), indent=2)
"
fi

PHASE=$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['phase'])")
echo "Phase: $PHASE"
```

### Step 2a: Province Phase — Find next uncovered province

```bash
if [ "$PHASE" = "province" ]; then
  # Get provinces ordered by fewest sources (priority = need more coverage)
  TARGET=$(sqlite3 "$AKIRA_DB" "
    SELECT l.id, l.name,
      (SELECT COUNT(*) FROM sources s WHERE s.location_id = l.id AND s.is_active = 1) as src_count
    FROM locations l
    WHERE l.type = 'provincia'
    ORDER BY src_count ASC, l.population DESC
    LIMIT 1 OFFSET (
      SELECT COALESCE(
        (SELECT value FROM json_each(
          (SELECT json_extract(value, '$.phase_history.province.completed') FROM (SELECT readfile('$STATE_FILE') as value)),
          '$'
        )),
        0
      )
    )
  ")

  # Fallback: use Python for state management
  python3 << 'PYEOF'
import json, sqlite3, subprocess

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
STATE_FILE = "/Users/omatic/.hermes/scout_state.json"

with open(STATE_FILE) as f:
    state = json.load(f)

conn = sqlite3.connect(AKIRA_DB)

# Get provinces ordered by fewest sources
provinces = conn.execute("""
    SELECT l.id, l.name, l.population,
      (SELECT COUNT(*) FROM sources s WHERE s.location_id = l.id AND s.is_active = 1) as src_count
    FROM locations l
    WHERE l.type = 'provincia'
    ORDER BY src_count ASC, l.population DESC
""").fetchall()

idx = state['province_idx'] + 1
if idx >= len(provinces):
    # Phase complete — advance to city phase
    state['phase'] = 'city'
    state['province_idx'] = -1
    state['city_idx'] = -1
    json.dump(state, open(STATE_FILE, 'w'), indent=2)
    print("PHASE COMPLETE: Advancing to city phase")
else:
    prov_id, prov_name, prov_pop, src_count = provinces[idx]
    print(f"TARGET: Province {idx + 1}/{len(provinces)}: {prov_name} ({src_count} sources)")
    
    state['province_idx'] = idx
    state['last_run'] = __import__('datetime').datetime.now().isoformat()
    state['total_runs'] = state.get('total_runs', 0) + 1
    state['phase_history']['province']['completed'] = idx + 1
    json.dump(state, open(STATE_FILE, 'w'), indent=2)
    
    # Print search queries for the agent to execute
    print(f"\nSEARCH QUERIES for {prov_name}:")
    print(f'1. web_search(query="noticias {prov_name} Argentina portal")')
    print(f'2. web_search(query="{prov_name} diario digital online")')
    print(f'3. web_search(query="{prov_name} noticiero digital")')
    print(f'4. web_search(query="site:.com.ar {prov_name} noticias últimas hora")')
    print(f'5. web_search(query="medios de comunicación {prov_name} Argentina")')

conn.close()
PYEOF
fi
```

### Step 2b: City Phase — Find next uncovered city from cp.json

```bash
if [ "$PHASE" = "city" ]; then
  python3 << 'PYEOF'
import json, sqlite3

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
STATE_FILE = "/Users/omatic/.hermes/scout_state.json"
CP_JSON = "/Users/omatic/proyectos/news/data/cp.json"

with open(STATE_FILE) as f:
    state = json.load(f)

with open(CP_JSON) as f:
    cp_data = json.load(f)

conn = sqlite3.connect(AKIRA_DB)

# Get cities ordered by fewest sources, then by population
# Use cp.json as the source of truth for all Argentine localities
cities_with_sources = conn.execute("""
    SELECT l.name, l.province,
      (SELECT COUNT(*) FROM sources s WHERE s.location_id = l.id AND s.is_active = 1) as src_count
    FROM locations l
    WHERE l.type = 'ciudad'
""").fetchall()

source_map = {f"{name}|{prov}": count for name, prov, count in cities_with_sources}

# Sort cp.json cities by: 1) fewest sources, 2) category priority
def city_priority(city):
    key = f"{city['nombre']}|{city['provincia']}"
    src_count = source_map.get(key, 0)
    # Prioritize: Entidad > Localidad simple > Componente
    cat_priority = {'Entidad': 0, 'Localidad simple': 1, 'Componente de localidad compuesta': 2}
    return (src_count, cat_priority.get(city.get('categoria', ''), 3))

sorted_cities = sorted(cp_data, key=city_priority)

idx = state['city_idx'] + 1
if idx >= len(sorted_cities):
    # Phase complete — advance to deep phase
    state['phase'] = 'deep'
    state['city_idx'] = -1
    state['deep_idx'] = -1
    json.dump(state, open(STATE_FILE, 'w'), indent=2)
    print("PHASE COMPLETE: Advancing to deep search phase")
else:
    city = sorted_cities[idx]
    city_name = city['nombre']
    city_prov = city['provincia']
    city_dept = city.get('departamento', '')
    src_count = source_map.get(f"{city_name}|{city_prov}", 0)
    
    print(f"TARGET: City {idx + 1}/{len(sorted_cities)}: {city_name}, {city_prov} ({src_count} sources)")
    print(f"Department: {city_dept}")
    
    state['city_idx'] = idx
    state['last_run'] = __import__('datetime').datetime.now().isoformat()
    state['total_runs'] = state.get('total_runs', 0) + 1
    state['phase_history']['city']['completed'] = idx + 1
    json.dump(state, open(STATE_FILE, 'w'), indent=2)
    
    # Print search queries for the agent to execute
    print(f"\nSEARCH QUERIES for {city_name}, {city_prov}:")
    print(f'1. web_search(query="noticias {city_name} {city_prov}")')
    print(f'2. web_search(query="{city_name} {city_prov} diario digital")')
    print(f'3. web_search(query="site:.com.ar {city_name} noticias")')

conn.close()
PYEOF
fi
```

### Step 3: Execute searches

For each phase, use the **MiniMax MCP `web_search` tool** with the queries printed by the Python script.

**IMPORTANT**: Execute ALL search queries in parallel, not sequentially.

### Step 4: Validate and register sources (FAST — parallel validation)

**CRITICAL**: Use the Python script below for parallel validation. Do NOT validate sequentially — it will timeout.

```bash
python3 << 'PYEOF'
import sqlite3, subprocess, json, concurrent.futures

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"

# Fill candidates from web_search results
# Format: (name, url, domain)
candidates = [
    # e.g. ("El Tribuno", "https://www.eltribuno.com/", "eltribuno.com"),
]

LOCATION_ID = # FILL THIS — province_id or city_id from target, e.g.:
  # Province: sqlite3 "$AKIRA_DB" "SELECT id FROM locations WHERE type='provincia' AND name='Tierra del Fuego'"
  # City: sqlite3 "$AKIRA_DB" "SELECT id FROM locations WHERE name='Ushuaia' AND province='Tierra del Fuego'"

if not candidates:
    print("No candidates to validate")
    exit(0)

conn = sqlite3.connect(AKIRA_DB)
existing = set(r[0] for r in conn.execute(
    "SELECT domain FROM sources WHERE is_active=1"
).fetchall())
conn.close()

def validate_candidate(name, url, domain):
    if domain in existing:
        return None
    
    # Quick check: just hit the homepage (3s timeout)
    code = subprocess.run(
        f"curl -s -o /dev/null -w '%{{http_code}}' --max-time 3 {url}",
        shell=True, capture_output=True, text=True
    ).stdout.strip()
    
    if code == "200":
        # Try RSS (2s timeout)
        rss_url = None
        for path in ["/feed/", "/rss"]:
            r = subprocess.run(
                f"curl -s -o /dev/null -w '%{{http_code}}' --max-time 2 {url}{path}",
                shell=True, capture_output=True, text=True
            ).stdout.strip()
            if r == "200":
                rss_url = f"{url}{path}"
                break
        
        return (name, url, domain, rss_url)
    return None

# Validate ALL candidates in PARALLEL (max 10 concurrent)
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    futures = {executor.submit(validate_candidate, n, u, d): (n, u, d) 
               for n, u, d in candidates}
    
    registered = 0
    conn = sqlite3.connect(AKIRA_DB)
    for future in concurrent.futures.as_completed(futures):
        result = future.result()
        if result:
            name, url, domain, rss_url = result
            conn.execute(
                "INSERT OR IGNORE INTO sources (name, url, domain, location_id, type, rss_url, is_active, reliability_score) VALUES (?, ?, ?, ?, 'diario', ?, 1, 0.5)",
                (name, url, domain, LOCATION_ID, rss_url)
            )
            registered += 1
            print(f"  + {name} ({domain})")
    conn.commit()
    conn.close()
    print(f"\nRegistered {registered} new sources")
PYEOF
```

### Step 4: Validate and register sources

```bash
check_source() {
  local url=$1
  local name=$2
  local location_id=$3
  local source_type=$4

  # Reject known bad domains
  case "$url" in
    *.gob.ar|*.gov.ar|facebook.com|instagram.com|twitter.com|x.com|youtube.com|tiktok.com|wordpress.com|blogspot.com|medium.com|linkedin.com)
      return 1
      ;;
  esac

  # Check if already exists
  DOMAIN=$(echo $url | sed 's|https\?://||' | cut -d/ -f1)
  EXISTS=$(sqlite3 "$AKIRA_DB" "SELECT COUNT(*) FROM sources WHERE domain = '$DOMAIN'")
  [ "$EXISTS" -gt 0 ] && return 1

  # Try RSS
  for path in "/feed/" "/rss" "/feed/rss2" "/rss2.xml"; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${url}${path}" 2>/dev/null)
    [ "$STATUS" = "200" ] && {
      sqlite3 "$AKIRA_DB" "INSERT OR IGNORE INTO sources (name, url, domain, location_id, type, rss_url, is_active, reliability_score) VALUES ('${name}', '${url}', '${DOMAIN}', ${location_id}, '${source_type}', '${url}${path}', 1, 0.5);"
      echo "REGISTERED: $name ($url) [RSS]"
      return 0
    }
  done

  # Try WordPress API
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${url}/wp-json/wp/v2/posts?per_page=1" 2>/dev/null)
  [ "$STATUS" = "200" ] && {
    sqlite3 "$AKIRA_DB" "INSERT OR IGNORE INTO sources (name, url, domain, location_id, type, wp_api_url, is_active, reliability_score) VALUES ('${name}', '${url}', '${DOMAIN}', ${location_id}, '${source_type}', '${url}/wp-json/wp/v2/posts', 1, 0.5);"
    echo "REGISTERED: $name ($url) [WP]"
    return 0
  }

  # Try Sitemap
  for path in "/sitemap.xml" "/sitemap_index.xml"; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${url}${path}" 2>/dev/null)
    [ "$STATUS" = "200" ] && {
      sqlite3 "$AKIRA_DB" "INSERT OR IGNORE INTO sources (name, url, domain, location_id, type, sitemap_url, is_active, reliability_score) VALUES ('${name}', '${url}', '${DOMAIN}', ${location_id}, '${source_type}', '${url}${path}', 1, 0.5);"
      echo "REGISTERED: $name ($url) [Sitemap]"
      return 0
    }
  done

  return 1
}
```

## Cron Schedule

```
hermes cron add --skill akira-scout --schedule "0 */6 * * *"
```

## Expected Behavior

| Run | Phase | Target | Queries | Est. Time |
|-----|-------|--------|---------|-----------|
| 1 | Province | Tierra del Fuego (0 sources) | 5 | ~2 min |
| 2 | Province | Chubut (3 sources) | 5 | ~2 min |
| 3 | Province | La Pampa (5 sources) | 5 | ~2 min |
| ... | ... | ... | ... | ... |
| 24 | Province | Buenos Aires (most sources) | 5 | ~2 min |
| 25 | City | First uncovered city from cp.json | 3 | ~1 min |
| ... | ... | ... | ... | ... |
| 4061 | City | Last uncovered city | 3 | ~1 min |
| 4062+ | Deep | Radio/TV/Podcasts | 5 | ~2 min |

**Key principle: Each run targets ONE specific area from the official dataset, never repeats, always moves forward.**

## Verification (Post-Run)

After execution, verify scout actually found and registered new sources:

```bash
python3 -c "
import sqlite3, json
from datetime import datetime
AKIRA_DB = '/Users/omatic/proyectos/news/packages/akira/data/akira.db'
STATE_FILE = '/Users/omatic/.hermes/scout_state.json'
conn = sqlite3.connect(AKIRA_DB)

# Sources registered in last run (last 5 minutes)
recent = conn.execute(\"\"\"
    SELECT COUNT(*) FROM sources
    WHERE created_at >= datetime('now', '-5 minutes')
\"\"\").fetchone()[0]

# Total active sources
total = conn.execute('SELECT COUNT(*) FROM sources WHERE is_active=1').fetchone()[0]

# Sources without location (bad data — should be 0)
no_loc = conn.execute('SELECT COUNT(*) FROM sources WHERE location_id IS NULL').fetchone()[0]

print(f'New sources (last 5 min): {recent}')
print(f'Total active sources: {total}')
print(f'Sources without location: {no_loc}')

conn.close()

# Current state
with open(STATE_FILE) as f:
    state = json.load(f)
print(f\"State: phase={state['phase']}, province={state['province_idx']+1}/24, city={state['city_idx']+1}/4037\")
"
```

**If verification fails:**
- New sources = 0: search queries may have returned no results — check query format
- Sources without location > 0: the `LOCATION_ID` was not filled in Step 4 validation script
- State stuck: check if `phase_history` counts match total runs

**Validate state transitions:**
```bash
# Verify state advanced correctly
python3 -c "
import json
s = json.load(open('/Users/omatic/.hermes/scout_state.json'))
print(f\"Phase: {s['phase']}\")
print(f\"  Province idx: {s['province_idx']} (history: {s['phase_history']['province']['completed']})\")
print(f\"  City idx: {s['city_idx']} (history: {s['phase_history']['city']['completed']})\")
print(f\"  Deep idx: {s['deep_idx']} (history: {s['phase_history']['deep']['completed']})\")
print(f\"Total runs: {s['total_runs']}\")
"
