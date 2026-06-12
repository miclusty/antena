# TODO - Plan de Consolidación de Bases Sólidas AKIRA (ARCHIVED — HISTORICAL REFERENCE)

## AVISO: Este documento está obsoleto

**Este archivo fue generado durante Phase 0-7 y NUNCA fue actualizado después de completar el trabajo.**
**Para el estado actual ver `AGENTS.md` en la raíz del proyecto.**

**Estado Actual (May 2026):**
- AKIRA v4.0.0 ✅ — FastAPI en puerto 5000
- **1075 fuentes, 7306 news_cards** ✅ (antes: 917 fuentes, 3339 noticias — stats desactualizados)
- 3921 localidades argentinas ✅
- **Skills de Hermes INSTALADOS** ✅ (akira-scout, akira-harvester, akira-analyst, etc.)
- **Pipeline automatizado CORRIENDO** ✅
- **Código refactorizado** ✅ — db_helpers, context managers, unified schema
- **Schema unificado** ✅ — migrations/0002_unified_schema.sql
- **Puerto estandarizado a 5000** ✅
- **newspaper4k en todas partes** ✅
- **.gitignore corregido** ✅
- **Hermes skills instalados** ✅
- **TODOS los items de Phase 0-7 RESUELTOS** ✅

---

Este documento se reteniene solo como referencia histórica. Todo el trabajo planificado aquí fue completado.

## Resumen Ejecutivo

Este documento detalla el plan completo para consolidar las bases del proyecto AKIRA, transformándolo de un estado "atado con alambres" a un sistema con bases sólidas, buenas prácticas y automatización completa.

**Estado Actual:**
- AKIRA (FastAPI) corre como servicio HTTP ✅
- 1075 fuentes, 7274 noticias en akira.db ✅
- 3921 localidades argentinas ✅
- 95 tests unitarios ✅
- **Skills de Hermes NO instalados** ❌
- **Pipeline automatizado NO corre** ❌
- **Código con malas prácticas** ❌
- **Schema inconsistente** ❌
- **Inconsistencia de puertos (5000 vs 5050)** ❌
- **Dependencias inconsistentes (newspaper3k vs newspaper4k)** ❌
- **Directorios inexistentes en configuración** ❌
- **Archivos duplicados/obsoletos en raíz** ❌
- **Secrets hardcoded en scripts** ❌
- **.gitignore con formato incorrecto** ❌

**Objetivo:**
- Instalar Hermes skills para automatizar el pipeline
- Limpiar código basura y refactorizar malas prácticas
- Consolidar schema entre akira.db y D1
- Integrar AKIRA → API → Antena end-to-end
- Documentar y agregar tests de integración

**Timeline:** 19-29 horas (3-4 días de trabajo intenso)

---

## Hallazgos Adicionales de Revisión Exhaustiva

### Problemas Críticos Encontrados (Adicionales)

1. **Inconsistencia de Puertos (5000 vs 5050)**
   - `config.py` usa puerto 5050
   - `AGENTS.md` documenta puerto 5000
   - `docker-compose.yml` usa puerto 5000
   - `packages/api/src/routes/synthesis.ts` usa localhost:5050
   - `packages/api/src/lib/python-extractor.ts` usa localhost:5050
   - **Impacto:** Conexiones fallan entre componentes
   - **Solución:** Estandarizar en puerto 5000 (documentado en AGENTS.md)

2. **Dependencias Inconsistentes (newspaper3k vs newspaper4k)**
   - `requirements.txt` usa `newspaper3k>=0.2.8`
   - `pyproject.toml` usa `newspaper4k>=0.9.0`
   - `extractors/newspaper.py` usa newspaper4k
   - **Impacto:** Instalación inconsistente según método
   - **Solución:** Usar newspaper4k en todos lados (versión más nueva)

3. **Directorios Inexistentes en Configuración**
   - `docker-compose.yml` referencia `./packages/extractor` (no existe, es `packages/akira`)
   - `docker-compose.yml` referencia `./packages/web` (no existe, es `packages/antena`)
   - `ecosystem.config.cjs` referencia `./packages/web` (no existe)
   - `tsconfig.json` referencia `packages/web` (no existe)
   - **Impacto:** Scripts de deployment fallan
   - **Solución:** Actualizar referencias a `packages/akira` y `packages/antena`

4. **Archivos Duplicados/Obsoletos en Raíz**
   - `harvest_run.py` (6KB) - script obsoleto en raíz
   - `test_rss_sources.py` (1KB) - test obsoleto en raíz
   - `cp.js` (884KB) - datos geográficos gigantes en raíz
   - `leads.json` (39MB) - duplicado en raíz y docs/temp/
   - `seeds_candidates.json` (369KB) - archivo de seeds en raíz
   - `borrador.md` (16KB) - borrador de especificación
   - `mempalace.yaml` (621B) - configuración de mempalace
   - `entities.json` (170B) - archivo de entidades
   - **Impacto:** Contaminación del directorio raíz
   - **Solución:** Mover a `docs/temp/` o eliminar

5. **Secrets Hardcoded en Scripts**
   - `scripts/extract-official-sources.sh` tiene MINIMAX_API_KEY hardcoded
   - Línea 8: `API_KEY="${MINIMAX_API_KEY:-sk-cp-ziJ2R6XtK6Ik-xCYa38dWVF4OZrGebrM3E2xs_3s1xMU04--3AhTZ--2RyXSgyYyh3cS4-GLXNvY2BUFG6wK-ERXnWOUOCK1Hhn6lB-zMP2t_OqBWD2xxU8}"`
   - **Impacto:** Seguridad crítica - API key expuesta
   - **Solución:** Remover hardcoded key, usar variable de entorno

6. **.gitignore con Formato Incorrecto**
   - Línea 10: `harvest_run.py test_rss_sources.py packages/akira/uv.lock` (archivos específicos en lugar de patrones)
   - Falta `.ruff_cache/`
   - Falta `.wrangler/`
   - Falta `.worktrees/`
   - Falta `__pycache__/` en raíz
   - Falta `.pytest_cache/`
   - Falta `.venv/` en packages/akira
   - Falta `uv.lock` en packages/akira
   - Falta `akira.egg-info/` en packages/akira
   - Falta `.astro/` en packages/antena
   - Falta `dist/` en packages/antena
   - Falta `node_modules/` en packages/api y packages/antena
   - **Impacto:** Archivos temporales y build se comitean
   - **Solución:** Reescribir .gitignore con patrones correctos

7. **Archivos de Build/Cache No Ignorados**
   - `packages/akira/.venv/` (virtual environment)
   - `packages/akira/uv.lock` (832KB - lock file de uv)
   - `packages/akira/akira.egg-info/` (build artifacts)
   - `packages/akira/.pytest_cache/` (cache de tests)
   - `packages/akira/__pycache__/` (Python cache)
   - `packages/antena/.astro/` (build cache de Astro)
   - `packages/antena/dist/` (build output)
   - `packages/api/dist/` (build output)
   - `packages/api/node_modules/` (dependencias)
   - `packages/antena/node_modules/` (dependencias)
   - **Impacto:** Repo contaminado con archivos generados
   - **Solución:** Agregar a .gitignore

8. **.DS_Store en Raíz**
   - Archivo `.DS_Store` de 8KB en raíz
   - **Impacto:** Archivo de sistema macOS en repo
   - **Solución:** Agregar a .gitignore y eliminar

9. **Documentación Obsoleta en Raíz**
   - `borrador.md` - especificación antigua
   - `mempalace.yaml` - configuración no usada
   - `entities.json` - archivo no usado
   - **Impacto:** Confusión sobre documentación actual
   - **Solución:** Mover a `docs/archive/` o eliminar

10. **Scripts de Deployment Obsoletos**
    - `docker-compose.yml` referencia directorios inexistentes
    - `ecosystem.config.cjs` referencia packages/web
    - **Impacto:** Deployment falla
    - **Solución:** Actualizar referencias

11. **Variables de Entorno Inconsistentes**
    - `AKIRA_API` en algunos scripts usa 5000
    - `PYTHON_EXTRACTOR_URL` en API usa 5050
    - **Impacto:** Conexiones fallan
    - **Solución:** Estandarizar en 5000

12. **Archivo cp.js Gigante en Raíz**
    - 884KB de datos geográficos en JavaScript
    - Debería estar en `data/` o `docs/data/`
    - **Impacto:** Contaminación de raíz
    - **Solución:** Mover a `data/cp.js` o eliminar si no se usa

13. **leads.json Duplicado**
    - 39MB en raíz
    - Duplicado en docs/temp/leads.json
    - **Impacto:** Espacio duplicado, confusión
    - **Solución:** Eliminar duplicado, mantener solo en docs/temp/

14. **seeds_candidates.json en Raíz**
    - 369KB de seeds
    - Debería estar en `data/` o `scripts/`
    - **Impacto:** Contaminación de raíz
    - **Solución:** Mover a `data/` o `scripts/`

### Estructura Actual del Proyecto

```
/Users/omatic/proyectos/news/
├── packages/
│   ├── akira/          # Motor de extracción (Python/FastAPI)
│   │   ├── core/        # 15 archivos de engine
│   │   ├── extractors/  # 12 extractores
│   │   ├── models/      # 2 schemas
│   │   ├── services/    # 1 servicio (google_news)
│   │   ├── skills/      # 8 skills de Hermes
│   │   ├── tests/       # 15 tests
│   │   ├── data/        # akira.db, locations.db
│   │   └── main.py      # Puerto 5050 (configurado)
│   ├── api/            # API de almacenamiento (Node/Hono)
│   │   ├── src/
│   │   │   ├── routes/  # 14 endpoints
│   │   │   ├── lib/     # 9 librerías
│   │   │   └── middleware/ # 1 middleware
│   │   └── package.json # Puerto 8787
│   └── antena/         # Frontend público (Astro + Solid.js)
│       ├── src/         # Componentes y páginas
│       ├── public/      # Assets estáticos
│       └── package.json # Puerto 4321
├── scripts/            # 20 scripts de utilidad
├── migrations/         # 1 migration SQL
├── docs/               # Documentación
├── data/               # cp.json (datos geográficos)
└── [ARCHIVOS BASURA]   # harvest_run.py, test_rss_sources.py, cp.js, leads.json, etc.
```

### Dependencias por Paquete

**packages/akira (Python):**
- fastapi>=0.110.0
- uvicorn[standard]>=0.29.0
- pydantic>=2.6.0
- pydantic-settings>=2.0.0
- aiohttp>=3.9.0
- feedparser>=6.0.11
- newspaper4k>=0.9.0 (INCONSISTENTE con requirements.txt)
- goose3>=3.1.19
- playwright>=1.42.0
- lxml>=5.1.0
- beautifulsoup4>=4.12.0

**packages/api (Node):**
- better-sqlite3@^12.8.0
- fast-xml-parser@^5.5.9
- hono@^4.7.0
- wrangler@^4.0.0

**packages/antena (Node):**
- astro@^5.0.0
- @astrojs/solid-js@^5.0.0
- solid-js@^1.9.0
- @astrojs/tailwind@^5.1.4
- tailwindcss@^3.4.0

---

## FASE 0: Arreglar Problemas Críticos de Configuración

**Tiempo estimado:** 1-2 horas

**Prioridad:** CRÍTICA - Debe hacerse antes de cualquier otra fase

### Tarea 0.1: Estandarizar Puertos (5000 vs 5050)

**Archivos a actualizar:**
1. `packages/akira/config.py` - cambiar puerto de 5050 a 5000
2. `packages/api/src/routes/synthesis.ts` - cambiar localhost:5050 a localhost:5000
3. `packages/api/src/lib/python-extractor.ts` - cambiar localhost:5050 a localhost:5000
4. `packages/api/src/routes/extract-unified.ts` - cambiar localhost:5050 a localhost:5000
5. `packages/api/src/routes/python.ts` - cambiar localhost:5050 a localhost:5000

**Comandos:**
```bash
# Editar config.py
sed -i '' 's/port: int = 5050/port: int = 5000/' packages/akira/config.py

# Editar archivos TypeScript
find packages/api/src -name "*.ts" -exec sed -i '' 's/localhost:5050/localhost:5000/g' {} +
```

**Verificación:**
```bash
grep -r "5050" packages/akira/config.py packages/api/src/
# Debe no retornar resultados
```

### Tarea 0.2: Unificar Dependencias (newspaper3k vs newspaper4k)

**Archivo a actualizar:**
- `packages/akira/requirements.txt`

**Cambio:**
```diff
- newspaper3k>=0.2.8
+ newspaper4k>=0.9.0
```

**Comando:**
```bash
sed -i '' 's/newspaper3k>=0.2.8/newspaper4k>=0.9.0/' packages/akira/requirements.txt
```

**Verificación:**
```bash
cat packages/akira/requirements.txt
# Debe mostrar newspaper4k>=0.9.0
```

### Tarea 0.3: Actualizar Referencias de Directorios Inexistentes

**Archivos a actualizar:**
1. `docker-compose.yml` - cambiar `./packages/extractor` a `./packages/akira`
2. `docker-compose.yml` - cambiar `./packages/web` a `./packages/antena`
3. `ecosystem.config.cjs` - cambiar `./packages/web` a `./packages/antena`
4. `tsconfig.json` - cambiar `packages/web` a `packages/antena`
5. `scripts/start.sh` - cambiar `packages/web` a `packages/antena`

**Comandos:**
```bash
# docker-compose.yml
sed -i '' 's|./packages/extractor|./packages/akira|g' docker-compose.yml
sed -i '' 's|./packages/web|./packages/antena|g' docker-compose.yml

# ecosystem.config.cjs
sed -i '' 's|packages/web|packages/antena|g' ecosystem.config.cjs

# tsconfig.json
sed -i '' 's|packages/web|packages/antena|g' tsconfig.json

# scripts/start.sh
sed -i '' 's|packages/web|packages/antena|g' scripts/start.sh
```

**Verificación:**
```bash
grep -r "packages/extractor\|packages/web" docker-compose.yml ecosystem.config.cjs tsconfig.json scripts/start.sh
# Debe no retornar resultados
```

### Tarea 0.4: Eliminar Secrets Hardcoded

**Archivo a actualizar:**
- `scripts/extract-official-sources.sh`

**Cambio:**
```diff
- API_KEY="${MINIMAX_API_KEY:-sk-cp-ziJ2R6XtK6Ik-xCYa38dWVF4OZrGebrM3E2xs_3s1xMU04--3AhTZ--2RyXSgyYyh3cS4-GLXNvY2BUFG6wK-ERXnWOUOCK1Hhn6lB-zMP2t_OqBWD2xxU8}"
+ API_KEY="${MINIMAX_API_KEY}"
```

**Comando:**
```bash
sed -i '' 's|API_KEY="${MINIMAX_API_KEY:-sk-cp-ziJ2R6XtK6Ik-xCYa38dWVF4OZrGebrM3E2xs_3s1xMU04--3AhTZ--2RyXSgyYyh3cS4-GLXNvY2BUFG6wK-ERXnWOUOCK1Hhn6lB-zMP2t_OqBWD2xxU8}"|API_KEY="${MINIMAX_API_KEY}"|g' scripts/extract-official-sources.sh
```

**Verificación:**
```bash
grep "sk-cp-" scripts/extract-official-sources.sh
# Debe no retornar resultados
```

### Tarea 0.5: Reescribir .gitignore

**Archivo:** `.gitignore`

**Nuevo contenido:**
```gitignore
# Node
node_modules/
dist/
.wrangler/

# Environment
.env
.env.local
.env.*.local
.dev.vars

# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
.venv/
venv/
*.egg-info/
*.egg
.pytest_cache/
.ruff_cache/
uv.lock

# SQLite
*.db
*.db-shm
*.db-wal
*.db.backup*
*.sqlite

# macOS
.DS_Store
.AppleDouble
.LSOverride

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
Thumbs.db

# Build
build/

# Worktrees
.worktrees/

# Logs
*.log
logs/

# Temporary files
*.tmp
*.bak
*.backup
docs/temp/

# Package-specific
packages/akira/.venv/
packages/akira/uv.lock
packages/akira/akira.egg-info/
packages/akira/__pycache__/
packages/akira/.pytest_cache/
packages/akira/.ruff_cache/
packages/antena/.astro/
packages/antena/dist/
packages/api/dist/
```

**Comando:**
```bash
cat > .gitignore << 'EOF'
# Node
node_modules/
dist/
.wrangler/

# Environment
.env
.env.local
.env.*.local
.dev.vars

# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
.venv/
venv/
*.egg-info/
*.egg
.pytest_cache/
.ruff_cache/
uv.lock

# SQLite
*.db
*.db-shm
*.db-wal
*.db.backup*
*.sqlite

# macOS
.DS_Store
.AppleDouble
.LSOverride

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
Thumbs.db

# Build
build/

# Worktrees
.worktrees/

# Logs
*.log
logs/

# Temporary files
*.tmp
*.bak
*.backup
docs/temp/

# Package-specific
packages/akira/.venv/
packages/akira/uv.lock
packages/akira/akira.egg-info/
packages/akira/__pycache__/
packages/akira/.pytest_cache/
packages/akira/.ruff_cache/
packages/antena/.astro/
packages/antena/dist/
packages/api/dist/
EOF
```

### Tarea 0.6: Limpiar Archivos Basura en Raíz

**Archivos a eliminar/mover:**
```bash
# Eliminar archivos obsoletos
rm harvest_run.py
rm test_rss_sources.py
rm borrador.md
rm mempalace.yaml
rm entities.json

# Mover archivos grandes a data/
mkdir -p data
mv cp.js data/ 2>/dev/null || true
mv seeds_candidates.json data/ 2>/dev/null || true

# Eliminar leads.json duplicado (mantener solo en docs/temp/)
rm leads.json

# Eliminar .DS_Store
rm -f .DS_Store
```

**Verificación:**
```bash
ls -la | grep -E "harvest_run|test_rss|borrador|mempalace|entities|cp\.js|leads\.json|\.DS_Store"
# Debe no retornar resultados
```

### Tarea 0.7: Limpiar Archivos de Build/Cache

**Comandos:**
```bash
# Python cache
find packages/akira -type d -name "__pycache__" -exec rm -rf {} +
find packages/akira -type f -name "*.pyc" -delete
find packages/akira -type d -name ".pytest_cache" -exec rm -rf {} +
find packages/akira -type d -name ".ruff_cache" -exec rm -rf {} +

# Build artifacts
rm -rf packages/akira/akira.egg-info
rm -rf packages/akira/.venv
rm -rf packages/akira/uv.lock

# Astro cache
rm -rf packages/antena/.astro
rm -rf packages/antena/dist

# API dist
rm -rf packages/api/dist
```

### Tarea 0.8: Verificar Configuración Final

**Comandos:**
```bash
# Verificar puerto 5000 en config.py
grep "port" packages/akira/config.py

# Verificar newspaper4k en requirements.txt
grep "newspaper" packages/akira/requirements.txt

# Verificar no hay referencias a directorios inexistentes
grep -r "packages/extractor\|packages/web" docker-compose.yml ecosystem.config.cjs tsconfig.json scripts/start.sh

# Verificar no hay secrets hardcoded
grep "sk-cp-" scripts/extract-official-sources.sh

# Verificar .gitignore
cat .gitignore

# Verificar archivos basura eliminados
ls -la | grep -E "harvest_run|test_rss|borrador|mempalace|entities|cp\.js|leads\.json"
```

### Criterios de Éxito Fase 0

- [ ] Puerto estandarizado en 5000
- [ ] Dependencias unificadas (newspaper4k)
- [ ] Referencias de directorios actualizadas
- [ ] Secrets hardcoded eliminados
- [ ] .gitignore reescrito correctamente
- [ ] Archivos basura en raíz eliminados
- [ ] Archivos de build/cache limpiados
- [ ] Configuración verificada

---

## FASE 1: Instalar y Configurar Hermes (Agente "Alma, Cabeza y Cuerpo")

**Tiempo estimado:** 2-4 horas

### Por qué Hermes es la mejor opción

- Skills ya diseñados específicamente para AKIRA
- No requiere reimplementación (solo instalación)
- Pipeline completo: Scout → Harvester → Analyst → Cleaner → Publisher → Supervisor
- Analyst v6.0 detecta sesgo político (-1.0 izquierda a +1.0 derecha)
- Synthesis Engine crea artículos neutrales multi-fuente
- Scout v11.0 usa cp.json oficial (4,037 localidades argentinas)

### Tarea 1.1: Copiar Skills a ~/.hermes/skills/

**Archivos a copiar:**
```
packages/akira/skills/akira-scout/SKILL.md → ~/.hermes/skills/akira-scout/SKILL.md
packages/akira/skills/akira-harvester/SKILL.md → ~/.hermes/skills/akira-harvester/SKILL.md
packages/akira/skills/akira-analyst/SKILL.md → ~/.hermes/skills/akira-analyst/SKILL.md
packages/akira/skills/akira-cleaner/SKILL.md → ~/.hermes/skills/akira-cleaner/SKILL.md
packages/akira/skills/akira-publisher/SKILL.md → ~/.hermes/skills/akira-publisher/SKILL.md
packages/akira/skills/akira-supervisor/SKILL.md → ~/.hermes/skills/akira-supervisor/SKILL.md
packages/akira/skills/akira-smart-harvester/SKILL.md → ~/.hermes/skills/akira-smart-harvester/SKILL.md
packages/akira/skills/akira-d1-harvest/SKILL.md → ~/.hermes/skills/akira-d1-harvest/SKILL.md
```

**Comandos:**
```bash
mkdir -p ~/.hermes/skills
cp -r packages/akira/skills/* ~/.hermes/skills/
```

**Verificación:**
```bash
ls -la ~/.hermes/skills/
# Debe mostrar 8 directorios de skills
```

### Tarea 1.2: Configurar Variables de Entorno

**Archivo:** `~/.hermes/.env`

**Variables necesarias:**
```bash
MINIMAX_API_KEY=tu_api_key_aqui
AKIRA_DB=/Users/omatic/proyectos/news/packages/akira/data/akira.db
AKIRA_API=http://localhost:5000
LM_STUDIO=http://localhost:1234
```

**Comandos:**
```bash
# Crear archivo .env si no existe
touch ~/.hermes/.env

# Agregar variables (editar manualmente)
nano ~/.hermes/.env
```

### Tarea 1.3: Configurar Cron Jobs en Hermes

**Schedule de skills:**
```bash
# Scout: cada 6 horas (descubre nuevas fuentes)
hermes cron add --skill akira-scout --schedule "0 */6 * * *"

# Harvester: cada 30 minutos (extrae noticias)
hermes cron add --skill akira-harvester --schedule "*/30 * * * *"

# Analyst: cada 15 minutos (detecta sesgo, categoriza, clusteriza)
hermes cron add --skill akira-analyst --schedule "*/15 * * * *"

# Cleaner: cada 15 minutos (filtra calidad, gacetillas)
hermes cron add --skill akira-cleaner --schedule "7 */15 * * * *"

# Publisher: cada 15 minutos (publica a API)
hermes cron add --skill akira-publisher --schedule "10 */15 * * * *"

# Supervisor: cada 6 horas (monitorea pipeline)
hermes cron add --skill akira-supervisor --schedule "30 */6 * * *"
```

**Verificación:**
```bash
hermes cron list
# Debe mostrar 6 cron jobs activos
```

### Tarea 1.4: Verificar AKIRA Corriendo

**Comandos:**
```bash
# Health check
curl http://localhost:5000/health | jq .

# Debe retornar:
# {
#   "status": "healthy",
#   "version": "4.0.0",
#   ...
# }
```

**Si AKIRA no está corriendo:**
```bash
cd packages/akira
python -m uvicorn main:app --host 0.0.0.0 --port 5000
```

### Tarea 1.5: Verificar LM Studio (para embeddings)

**Comandos:**
```bash
# Health check LM Studio
curl http://localhost:1234/v1/models

# Debe retornar lista de modelos disponibles
```

**Si LM Studio no está corriendo:**
- Abrir LM Studio
- Cargar modelo `text-embedding-nomic-embed-text-v1.5`
- Iniciar servidor en puerto 1234

### Tarea 1.6: Probar Pipeline Manual (Antes de Automatizar)

**Prueba 1: Scout (descubrir fuentes)**
```bash
hermes run akira-scout
# Debe descubrir nuevas fuentes y registrarlas en akira.db
```

**Verificación:**
```bash
sqlite3 packages/akira/data/akira.db "SELECT COUNT(*) FROM sources WHERE created_at >= datetime('now', '-1 hour')"
```

**Prueba 2: Harvester (extraer noticias)**
```bash
hermes run akira-harvester
# Debe extraer noticias de fuentes activas
```

**Verificación:**
```bash
sqlite3 packages/akira/data/akira.db "SELECT COUNT(*) FROM news_cards WHERE created_at >= datetime('now', '-1 hour')"
```

**Prueba 3: Analyst (analizar sesgo)**
```bash
hermes run akira-analyst
# Debe analizar noticias sin bias_score
```

**Verificación:**
```bash
sqlite3 packages/akira/data/akira.db "SELECT COUNT(*) FROM news_cards WHERE bias_score IS NOT NULL"
```

### Tarea 1.7: Habilitar Automatización

**Comandos:**
```bash
# Habilitar todos los crons
hermes cron enable --all

# Verificar estado
hermes cron status
```

### Criterios de Éxito Fase 1

- [ ] 8 skills copiados a ~/.hermes/skills/
- [ ] Variables de entorno configuradas en ~/.hermes/.env
- [ ] 6 cron jobs configurados en Hermes
- [ ] AKIRA corriendo en puerto 5000
- [ ] LM Studio corriendo en puerto 1234
- [ ] Scout prueba manual exitosa
- [ ] Harvester prueba manual exitosa
- [ ] Analyst prueba manual exitosa
- [ ] Automatización habilitada

---

## FASE 2: Limpieza de Código Basura

**Tiempo estimado:** 1 hora

### Tarea 2.1: Eliminar Archivos Duplicados

**Archivos a eliminar:**
```bash
# leads.json duplicado
rm /Users/omatic/proyectos/news/leads.json
rm /Users/omatic/proyectos/news/docs/temp/leads.json

# Backup files de DB
rm /Users/omatic/proyectos/news/packages/akira/data/akira.db.backup.*

# Archivos temporales
rm -rf /Users/omatic/proyectos/news/docs/temp/
```

### Tarea 2.2: Eliminar .DS_Store Files

**Comando:**
```bash
find /Users/omatic/proyectos/news -name ".DS_Store" -type f -delete
```

### Tarea 2.3: Limpiar __pycache__

**Comando:**
```bash
find /Users/omatic/proyectos/news/packages/akira -type d -name "__pycache__" -exec rm -rf {} +
find /Users/omatic/proyectos/news/packages/akira -type f -name "*.pyc" -delete
```

### Tarea 2.4: Actualizar .gitignore

**Archivo:** `.gitignore`

**Agregar:**
```gitignore
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# SQLite
*.db
*.db-shm
*.db-wal
*.db.backup*

# macOS
.DS_Store
.AppleDouble
.LSOverride

# Environment
.env
.env.local
.env.*.local

# Logs
*.log
logs/

# Temporary files
*.tmp
*.bak
*.backup
docs/temp/
```

### Tarea 2.5: Eliminar Código Comentado Obsoleto

**Archivos a revisar:**
- `packages/akira/main.py`
- `packages/akira/core/engine.py`
- `packages/akira/extractors/rss.py`

**Acción:**
- Buscar comentarios con `# TODO`, `# FIXME`, `# DEPRECATED`
- Eliminar código comentado que no se usa
- Documentar razones de eliminación en commit message

### Criterios de Éxito Fase 2

- [ ] leads.json duplicados eliminados
- [ ] .db.backup files eliminados
- [ ] docs/temp/ eliminado
- [ ] .DS_Store files eliminados
- [ ] __pycache__/ limpiado
- [ ] .gitignore actualizado
- [ ] Código comentado obsoleto eliminado

---

## FASE 3: Refactorización de Malas Prácticas

**Tiempo estimado:** 8-12 horas

### Tarea 3.1: Reemplazar `except:` con Excepciones Específicas

**Archivos afectados (13):**
1. `packages/akira/skills/akira-analyst/SKILL.md`
2. `packages/akira/skills/akira-d1-harvest/SKILL.md`
3. `packages/akira/skills/akira-harvester/SKILL.md`
4. `packages/akira/extractors/wordpress.py`
5. `packages/akira/extractors/playwright.py`
6. `packages/akira/extractors/rss.py`
7. `packages/akira/core/garbage_collector.py`
8. `packages/akira/core/browser_pool.py`
9. `packages/akira/core/source_recovery.py`
10. `packages/akira/core/engine.py`
11. `packages/akira/core/health_monitor.py`
12. `packages/akira/core/http_client.py`
13. `packages/akira/extractors/goose.py`

**Patrón a reemplazar:**
```python
# ANTES (mal)
try:
    # código
except:
    pass

# DESPUÉS (bien)
try:
    # código
except (ValueError, KeyError, sqlite3.Error) as e:
    logger.error(f"error_descriptivo: {e}")
```

**Excepciones comunes a usar:**
- `sqlite3.Error` - errores de base de datos
- `ValueError` - errores de valor
- `KeyError` - errores de clave
- `ConnectionError` - errores de conexión
- `TimeoutError` - errores de timeout
- `aiohttp.ClientError` - errores de HTTP client

### Tarea 3.2: Eliminar Variables Globales

**Variables globales a eliminar:**
1. `_last_cache_hits` en `packages/akira/main.py`
2. `_last_cache_misses` en `packages/akira/main.py`
3. `_goose_instance` en `packages/akira/extractors/goose.py`
4. `_last_fetch` en `packages/akira/extractors/rss.py`

**Solución:**
```python
# ANTES (mal)
_last_cache_hits = 0
_last_cache_misses = 0

# DESPUÉS (bien)
class MetricsTracker:
    def __init__(self):
        self._last_cache_hits = 0
        self._last_cache_misses = 0

metrics = MetricsTracker()
```

### Tarea 3.3: Mover Imports al Top de Archivos

**Archivos con imports dentro de funciones:**
1. `packages/akira/extractors/rss.py` - imports en línea 82, 193, 211, 231, 261, 265
2. `packages/akira/core/synthesis.py` - imports en línea 377

**Patrón a corregir:**
```python
# ANTES (mal)
async def extract(self, url):
    import feedparser  # import dentro de función
    # código

# DESPUÉS (bien)
import feedparser  # import al top

async def extract(self, url):
    # código
```

### Tarea 3.4: Agregar Context Managers para SQLite

**Archivos con SQLite sin context managers:**
- `packages/akira/core/engine.py`
- `packages/akira/core/method_learner.py`
- `packages/akira/core/synthesis.py`
- `packages/akira/extractors/rss.py`

**Patrón a corregir:**
```python
# ANTES (mal)
conn = sqlite3.connect(db_path)
conn.execute("SELECT ...")
conn.close()

# DESPUÉS (bien)
with sqlite3.connect(db_path) as conn:
    conn.execute("SELECT ...")
# conn.close() automático
```

### Tarea 3.5: Crear Helpers para DB Queries Repetidos

**Archivo nuevo:** `packages/akira/core/db_helpers.py`

**Funciones a crear:**
```python
"""Database query helpers to reduce code duplication."""

import sqlite3
from contextlib import contextmanager
from typing import List, Dict, Any, Optional

@contextmanager
def get_db_connection(db_path: str, timeout: int = 5):
    """Context manager for SQLite connections with timeout."""
    conn = sqlite3.connect(db_path, timeout=timeout)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def execute_query(db_path: str, query: str, params: tuple = ()) -> List[sqlite3.Row]:
    """Execute a SELECT query and return results."""
    with get_db_connection(db_path) as conn:
        return conn.execute(query, params).fetchall()

def execute_update(db_path: str, query: str, params: tuple = ()) -> int:
    """Execute an UPDATE/INSERT/DELETE query and return rowcount."""
    with get_db_connection(db_path) as conn:
        cursor = conn.execute(query, params)
        conn.commit()
        return cursor.rowcount

def batch_insert(db_path: str, table: str, columns: List[str], rows: List[tuple]) -> int:
    """Batch insert multiple rows."""
    if not rows:
        return 0
    
    placeholders = ",".join("?" for _ in columns)
    columns_str = ",".join(columns)
    query = f"INSERT INTO {table} ({columns_str}) VALUES ({placeholders})"
    
    with get_db_connection(db_path) as conn:
        cursor = conn.executemany(query, rows)
        conn.commit()
        return cursor.rowcount
```

**Usar helpers en:**
- `packages/akira/core/engine.py`
- `packages/akira/core/method_learner.py`
- `packages/akira/core/synthesis.py`
- `packages/akira/extractors/rss.py`

### Tarea 3.6: Usar Variables de Entorno para Paths

**Archivo:** `packages/akira/config.py`

**Agregar variables:**
```python
class Settings(BaseSettings):
    # ... existing settings ...
    
    # Environment-based paths
    akira_db_path: str = Field(
        default="packages/akira/data/akira.db",
        description="Path to akira.db"
    )
    hermes_state_path: str = Field(
        default="~/.hermes/scout_state.json",
        description="Path to Hermes scout state file"
    )
    cp_json_path: str = Field(
        default="data/cp.json",
        description="Path to cp.json (official localities)"
    )
    
    model_config = {"env_prefix": "AKIRA_", "env_file": ".env"}
```

**Actualizar archivos que usan paths hardcoded:**
- `packages/akira/skills/akira-scout/SKILL.md`
- `packages/akira/skills/akira-harvester/SKILL.md`
- `packages/akira/skills/akira-analyst/SKILL.md`
- `packages/akira/core/engine.py`
- `packages/akira/core/synthesis.py`

### Tarea 3.7: Unificar Dedup de URLs

**Problema:** Dedup implementado en `rss.py` Y `engine.py`

**Solución:** Mover lógica a `core/db_helpers.py`

**Función nueva:**
```python
def filter_seen_urls(db_path: str, urls: List[str], source_id: Optional[int] = None) -> List[str]:
    """Filter out URLs already in seen_urls table. Returns new URLs only."""
    if not urls:
        return []
    
    placeholders = ",".join("?" for _ in urls)
    query = f"SELECT url FROM seen_urls WHERE url IN ({placeholders})"
    
    with get_db_connection(db_path) as conn:
        seen_urls = set(row[0] for row in conn.execute(query, urls))
    
    new_urls = [url for url in urls if url not in seen_urls]
    
    # Batch insert new URLs
    if new_urls:
        batch_insert(
            db_path,
            "seen_urls",
            ["url", "source_id", "first_seen", "last_seen", "view_count"],
            [(url, source_id, "datetime('now')", "datetime('now')", 1) for url in new_urls]
        )
    
    return new_urls
```

**Actualizar:**
- `packages/akira/extractors/rss.py` - usar helper
- `packages/akira/core/engine.py` - usar helper

### Tarea 3.8: Estandarizar Logging

**Archivos con print() en lugar de logger:**
- `packages/akira/skills/akira-scout/SKILL.md`
- `packages/akira/skills/akira-harvester/SKILL.md`
- `packages/akira/skills/akira-analyst/SKILL.md`
- `packages/akira/skills/akira-cleaner/SKILL.md`
- `packages/akira/skills/akira-publisher/SKILL.md`
- `packages/akira/skills/akira-supervisor/SKILL.md`

**Patrón a corregir:**
```python
# ANTES (mal)
print(f"Processing {url}")

# DESPUÉS (bien)
logger.info(f"processing url={url}")
```

**Configurar logging estructurado:**
```python
# packages/akira/core/logging_config.py
import logging
import json
from typing import Any

class JSONFormatter(logging.Formatter):
    """Structured JSON logging formatter."""
    
    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if hasattr(record, "request_id"):
            log_entry["request_id"] = record.request_id
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_entry, ensure_ascii=False)

# Configurar en main.py
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("/tmp/akira-extractor.log")
    ]
)
```

### Criterios de Éxito Fase 3

- [ ] `except:` reemplazados con excepciones específicas (13 archivos)
- [ ] Variables globales eliminadas (4 variables)
- [ ] Imports movidos al top (2 archivos)
- [ ] Context managers agregados para SQLite (4 archivos)
- [ ] Helpers de DB creados en `core/db_helpers.py`
- [ ] Helpers usados en archivos correspondientes
- [ ] Variables de entorno para paths configuradas
- [ ] Dedup de URLs unificado
- [ ] Logging estandarizado (print() → logger)
- [ ] Tests pasan después de refactorización

---

## FASE 4: Consolidación de Schema

**Tiempo estimado:** 2-3 horas

### Tarea 4.1: Analizar Schema Actual

**Schema akira.db local:**
```bash
sqlite3 packages/akira/data/akira.db ".schema"
```

**Schema D1 Cloudflare:**
```bash
cat migrations/0001_complete_schema.sql
```

**Comparar:**
- Tablas en akira.db pero no en D1
- Tablas en D1 pero no en akira.db
- Diferencias en columnas
- Diferencias en índices

### Tarea 4.2: Identificar Tablas Faltantes

**Tablas en synthesis.py pero no en schema principal:**
- `master_articles` - artículos sintetizados neutrales

**Tablas en migration SQL pero no usadas:**
- `raw_news` - noticias extraídas (pipeline local)
- `processed_news` - noticias analizadas (pipeline local)
- `clean_news` - noticias limpias (pipeline local)

**Tablas usadas pero no documentadas:**
- `seen_urls` - dedup de URLs
- `source_health` - health tracking
- `extraction_stats` - estadísticas de extracción

### Tarea 4.3: Crear Schema Unificado

**Archivo nuevo:** `migrations/0002_unified_schema.sql`

**Contenido:**
```sql
-- Unified Schema for AKIRA v4.0
-- Compatible with both local SQLite and Cloudflare D1

-- =============================================
-- CATEGORIES
-- =============================================
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon TEXT
);

-- =============================================
-- LOCATIONS
-- =============================================
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  province TEXT NOT NULL,
  country TEXT DEFAULT 'AR',
  lat REAL,
  lng REAL,
  population INTEGER,
  type TEXT DEFAULT 'city',
  parent_id INTEGER,
  FOREIGN KEY (parent_id) REFERENCES locations(id)
);

CREATE INDEX IF NOT EXISTS idx_locations_type ON locations(type);
CREATE INDEX IF NOT EXISTS idx_locations_province ON locations(province);

-- =============================================
-- SOURCES
-- =============================================
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  domain TEXT,
  location_id INTEGER,
  province TEXT,
  type TEXT DEFAULT 'diario',
  rss_url TEXT,
  wp_api_url TEXT,
  sitemap_url TEXT,
  extraction_method TEXT,
  reliability_score REAL DEFAULT 0.5,
  is_active INTEGER DEFAULT 1,
  deactivation_reason TEXT,
  last_fetch DATETIME,
  last_success DATETIME,
  last_harvest_at DATETIME,
  fetch_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  news_count INTEGER DEFAULT 0,
  gacetilla_count INTEGER DEFAULT 0,
  avg_bias REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE INDEX IF NOT EXISTS idx_sources_active ON sources(is_active, last_fetch);
CREATE INDEX IF NOT EXISTS idx_sources_location ON sources(location_id);
CREATE INDEX IF NOT EXISTS idx_sources_domain ON sources(domain);

-- =============================================
-- SEEN_URLS (Delta extraction dedup)
-- =============================================
CREATE TABLE IF NOT EXISTS seen_urls (
  url TEXT PRIMARY KEY,
  source_id INTEGER,
  first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  view_count INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_seen_urls_source ON seen_urls(source_id);
CREATE INDEX IF NOT EXISTS idx_seen_urls_last_seen ON seen_urls(last_seen);

-- =============================================
-- SOURCE_HEALTH (Method learning + circuit breaker)
-- =============================================
CREATE TABLE IF NOT EXISTS source_health (
  source_id INTEGER PRIMARY KEY,
  url TEXT UNIQUE,
  last_success_method TEXT,
  success_count TEXT DEFAULT '{}',
  consecutive_failures INTEGER DEFAULT 0,
  is_circuit_open INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_source_health_circuit ON source_health(is_circuit_open);

-- =============================================
-- EXTRACTION_STATS (Method performance tracking)
-- =============================================
CREATE TABLE IF NOT EXISTS extraction_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT,
  method TEXT,
  duration_ms INTEGER,
  items_count INTEGER,
  success INTEGER,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_extraction_stats_timestamp ON extraction_stats(timestamp);
CREATE INDEX IF NOT EXISTS idx_extraction_stats_method ON extraction_stats(method);

-- =============================================
-- NEWS_CARDS (Public facing news)
-- =============================================
CREATE TABLE IF NOT EXISTS news_cards (
  id TEXT PRIMARY KEY,
  location_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  image_url TEXT,
  bias_score REAL DEFAULT 0,
  is_gacetilla INTEGER DEFAULT 0,
  gacetilla_confidence REAL DEFAULT 0,
  cluster_id TEXT,
  category TEXT,
  source_ids TEXT,
  published_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  body TEXT,
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE INDEX IF NOT EXISTS idx_news_location ON news_cards(location_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_category ON news_cards(category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_cluster ON news_cards(cluster_id);
CREATE INDEX IF NOT EXISTS idx_news_bias ON news_cards(bias_score);
CREATE INDEX IF NOT EXISTS idx_news_published ON news_cards(published_at DESC);

-- =============================================
-- MASTER_ARTICLES (Synthesized neutral articles)
-- =============================================
CREATE TABLE IF NOT EXISTS master_articles (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  verified_facts TEXT,
  disputed_claims TEXT,
  officialist_perspective TEXT,
  opposition_perspective TEXT,
  neutral_perspective TEXT,
  sources_count INTEGER,
  bias_min REAL,
  bias_max REAL,
  bias_avg REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_master_cluster ON master_articles(cluster_id);
CREATE INDEX IF NOT EXISTS idx_master_created ON master_articles(created_at DESC);

-- =============================================
-- METRICS (Pipeline execution tracking)
-- =============================================
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name TEXT NOT NULL,
  cycle_started DATETIME NOT NULL,
  cycle_ended DATETIME,
  duration_ms INTEGER,
  status TEXT DEFAULT 'success',
  items_processed INTEGER DEFAULT 0,
  items_success INTEGER DEFAULT 0,
  items_failed INTEGER DEFAULT 0,
  error_message TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_metrics_skill ON metrics(skill_name, cycle_started DESC);
```

### Tarea 4.4: Crear Migration Script

**Archivo:** `scripts/migrate-to-unified-schema.py`

```python
#!/usr/bin/env python3
"""Migrate existing akira.db to unified schema."""

import sqlite3
import sys

DB_PATH = "packages/akira/data/akira.db"
MIGRATION_SQL = "migrations/0002_unified_schema.sql"

def migrate():
    """Apply unified schema migration."""
    print(f"Migrating {DB_PATH} to unified schema...")
    
    # Backup existing DB
    import shutil
    backup_path = f"{DB_PATH}.backup.{int(time.time())}"
    shutil.copy2(DB_PATH, backup_path)
    print(f"Backup created: {backup_path}")
    
    # Read migration SQL
    with open(MIGRATION_SQL) as f:
        migration_sql = f.read()
    
    # Apply migration
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.executescript(migration_sql)
        conn.commit()
        print("Migration completed successfully")
    except Exception as e:
        conn.rollback()
        print(f"Migration failed: {e}")
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
```

### Tarea 4.5: Ejecutar Migration

**Comandos:**
```bash
python scripts/migrate-to-unified-schema.py
```

**Verificación:**
```bash
sqlite3 packages/akira/data/akira.db ".schema"
# Debe mostrar schema unificado
```

### Tarea 4.6: Documentar Schema

**Archivo nuevo:** `docs/schema.md`

**Contenido:**
```markdown
# AKIRA Database Schema

## Overview
Unified schema compatible with both local SQLite and Cloudflare D1.

## Tables

### categories
News categories (política, economía, deportes, etc.)

### locations
Argentine locations (118 cities, provinces, country)

### sources
News sources with health tracking and method learning

### seen_urls
URL deduplication for delta extraction

### source_health
Method learning and circuit breaker state

### extraction_stats
Performance tracking per method

### news_cards
Public facing news with bias, clustering, categorization

### master_articles
Synthesized neutral articles from clusters

### metrics
Pipeline execution tracking

## Relationships
- sources → locations (location_id)
- news_cards → locations (location_id)
- seen_urls → sources (source_id)
- source_health → sources (source_id)
- master_articles → news_cards (cluster_id)
```

### Criterios de Éxito Fase 4

- [ ] Schema actual analizado (akira.db vs D1)
- [ ] Tablas faltantes identificadas
- [ ] Schema unificado creado en `migrations/0002_unified_schema.sql`
- [ ] Migration script creado
- [ ] Migration ejecutada exitosamente
- [ ] Schema documentado en `docs/schema.md`
- [ ] Backup de DB creado antes de migration

---

## FASE 5: Integración AKIRA → API → Antena

**Tiempo estimado:** 4-6 horas

### Tarea 5.1: Verificar API Conectada a akira.db

**Archivo:** `packages/api/src/lib/db.ts`

**Verificar configuración:**
```typescript
// Debe apuntar a akira.db local o D1
const DB_PATH = process.env.AKIRA_DB || "packages/akira/data/akira.db";
```

**Test de conexión:**
```bash
cd packages/api
pnpm dev
curl http://localhost:8787/api/health
```

### Tarea 5.2: Verificar Endpoints de API

**Endpoints a probar:**
```bash
# Health check
curl http://localhost:8787/api/health

# News feed
curl http://localhost:8787/api/news/feed?limit=10

# Locations
curl http://localhost:8787/api/locations/tree

# Categories
curl http://localhost:8787/api/categories
```

### Tarea 5.3: Conectar Antena a API

**Archivo:** `packages/antena/src/lib/api.ts`

**Verificar URL de API:**
```typescript
const API_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:8787";
```

**Configurar variable de entorno:**
```bash
# packages/antena/.env
PUBLIC_API_URL=http://localhost:8787
```

### Tarea 5.4: Verificar Antena Muestra Datos Reales

**Iniciar Antena:**
```bash
cd packages/antena
pnpm dev
```

**Abrir navegador:**
```
http://localhost:4321
```

**Verificar:**
- [ ] Noticias se muestran en feed
- [ ] Filtros de ubicación funcionan
- [ ] Filtros de categoría funcionan
- [ ] Cards tienen imágenes
- [ ] Bias score se muestra
- [ ] Clusters se muestran

### Tarea 5.5: Implementar Tests de Integración

**Archivo nuevo:** `tests/integration/test_pipeline.py`

```python
"""Integration tests for AKIRA → API → Antena pipeline."""

import pytest
import sqlite3
import requests
import time

AKIRA_API = "http://localhost:5000"
API_API = "http://localhost:8787"
ANTENA_URL = "http://localhost:4321"
DB_PATH = "packages/akira/data/akira.db"

def test_akira_health():
    """Test AKIRA health endpoint."""
    response = requests.get(f"{AKIRA_API}/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"

def test_akira_extract():
    """Test AKIRA extraction endpoint."""
    response = requests.post(
        f"{AKIRA_API}/extract",
        json={"url": "https://www.infotuc.com.ar/feed/"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] == True
    assert len(data["items"]) > 0

def test_api_health():
    """Test API health endpoint."""
    response = requests.get(f"{API_API}/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"

def test_api_news_feed():
    """Test API news feed endpoint."""
    response = requests.get(f"{API_API}/api/news/feed?limit=10")
    assert response.status_code == 200
    data = response.json()
    assert len(data["news"]) <= 10

def test_api_locations():
    """Test API locations endpoint."""
    response = requests.get(f"{API_API}/api/locations/tree")
    assert response.status_code == 200
    data = response.json()
    assert len(data["locations"]) > 0

def test_antena_loads():
    """Test Antena frontend loads."""
    response = requests.get(ANTENA_URL)
    assert response.status_code == 200
    assert "AKIRA" in response.text or "Antena" in response.text

def test_end_to_end_pipeline():
    """Test full pipeline: AKIRA → API → Antena."""
    # 1. Extract news via AKIRA
    extract_response = requests.post(
        f"{AKIRA_API}/extract",
        json={"url": "https://www.infotuc.com.ar/feed/"}
    )
    assert extract_response.status_code == 200
    extract_data = extract_response.json()
    assert extract_data["success"] == True
    
    # 2. Wait for data to propagate
    time.sleep(2)
    
    # 3. Fetch via API
    api_response = requests.get(f"{API_API}/api/news/feed?limit=5")
    assert api_response.status_code == 200
    api_data = api_response.json()
    assert len(api_data["news"]) > 0
    
    # 4. Verify in DB
    conn = sqlite3.connect(DB_PATH)
    count = conn.execute("SELECT COUNT(*) FROM news_cards").fetchone()[0]
    conn.close()
    assert count > 0
```

**Ejecutar tests:**
```bash
pytest tests/integration/test_pipeline.py -v
```

### Tarea 5.6: Verificar Flujo Completo

**Flujo a verificar:**
1. Scout descubre nueva fuente
2. Harvester extrae noticias de fuente
3. Analyst analiza sesgo, categoriza, clusteriza
4. Cleaner filtra calidad
5. Publisher publica a API
6. API sirve datos a Antena
7. Antena muestra noticias en frontend

**Test manual:**
```bash
# 1. Ejecutar scout
hermes run akira-scout

# 2. Ejecutar harvester
hermes run akira-harvester

# 3. Ejecutar analyst
hermes run akira-analyst

# 4. Ejecutar cleaner
hermes run akira-cleaner

# 5. Ejecutar publisher
hermes run akira-publisher

# 6. Verificar API
curl http://localhost:8787/api/news/feed?limit=10

# 7. Verificar Antena
open http://localhost:4321
```

### Criterios de Éxito Fase 5

- [ ] API conectada a akira.db
- [ ] API endpoints responden correctamente
- [ ] Antena conectada a API
- [ ] Antena muestra datos reales
- [ ] Tests de integración creados
- [ ] Tests de integración pasan
- [ ] Flujo completo verificado manualmente

---

## FASE 6: Documentación y Tests

**Tiempo estimado:** 2-3 horas

### Tarea 6.1: Documentar Arquitectura Actual

**Archivo:** `docs/architecture.md`

**Contenido:**
```markdown
# AKIRA Architecture

## Overview
AKIRA is a hyperlocal news extraction engine for Argentina.

## Components

### AKIRA (Python/FastAPI)
- Port: 5000
- 10 extraction methods
- SQLite database (akira.db)
- Method learning
- Circuit breaker
- Rate limiting

### API (Node/Hono)
- Port: 8787
- Cloudflare Workers compatible
- D1 database
- KV cache
- CORS configured

### Antena (Astro + Solid.js)
- Port: 4321
- Reddit-style layout
- PWA manifest
- Dark theme (pending)
- Service Worker (pending)

## Pipeline

1. Scout discovers sources
2. Harvester extracts news
3. Analyst analyzes bias
4. Cleaner filters quality
5. Publisher publishes to API
6. Antena displays news

## Database Schema
See docs/schema.md

## Environment Variables
See .env.example
```

### Tarea 6.2: Documentar Variables de Entorno

**Archivo:** `.env.example`

**Contenido:**
```bash
# AKIRA
AKIRA_HOST=0.0.0.0
AKIRA_PORT=5000
AKIRA_DB=packages/akira/data/akira.db
AKIRA_DEBUG=false

# API
API_PORT=8787
API_DB_PATH=packages/akira/data/akira.db
API_CORS_ORIGINS=http://localhost:4321,http://localhost:4324

# Antena
PUBLIC_API_URL=http://localhost:8787

# Hermes
MINIMAX_API_KEY=your_minimax_api_key_here
LM_STUDIO_URL=http://localhost:1234

# Cloudflare (production)
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
D1_DATABASE_ID=your_d1_id
R2_BUCKET_NAME=your_bucket_name
KV_NAMESPACE_ID=your_kv_id
```

### Tarea 6.3: Crear Guía de Troubleshooting

**Archivo:** `docs/troubleshooting.md`

**Contenido:**
```markdown
# Troubleshooting Guide

## AKIRA not starting

**Problem:** AKIRA fails to start

**Solutions:**
1. Check port 5000 is not in use: `lsof -i :5000`
2. Check akira.db exists: `ls -la packages/akira/data/akira.db`
3. Check dependencies: `cd packages/akira && pip install -r requirements.txt`
4. Check logs: `tail -f /tmp/akira-extractor.log`

## Hermes skills not running

**Problem:** Skills not executing

**Solutions:**
1. Check skills installed: `ls -la ~/.hermes/skills/`
2. Check crons configured: `hermes cron list`
3. Check MINIMAX_API_KEY set: `cat ~/.hermes/.env`
4. Check AKIRA running: `curl http://localhost:5000/health`

## API not returning data

**Problem:** API returns empty feed

**Solutions:**
1. Check DB has data: `sqlite3 packages/akira/data/akira.db "SELECT COUNT(*) FROM news_cards"`
2. Check API connected to DB: Check packages/api/src/lib/db.ts
3. Check CORS: Check packages/api/src/index.ts
4. Check logs: Check API console output

## Antena not showing news

**Problem:** Antena shows empty feed

**Solutions:**
1. Check API returning data: `curl http://localhost:8787/api/news/feed`
2. Check API URL configured: Check packages/antena/.env
3. Check browser console for errors
4. Check network tab for failed requests

## Bias detection not working

**Problem:** News items have no bias_score

**Solutions:**
1. Check LM Studio running: `curl http://localhost:1234/v1/models`
2. Check analyst skill running: `hermes cron status`
3. Check MINIMAX_API_KEY valid
4. Check analyst logs: `hermes logs akira-analyst`
```

### Tarea 6.4: Agregar Tests Unitarios Faltantes

**Archivos a crear:**
- `packages/akira/tests/test_db_helpers.py`
- `packages/akira/tests/test_synthesis.py`
- `packages/api/tests/test_news_routes.test.ts`

**Ejemplo test_db_helpers.py:**
```python
"""Tests for db_helpers module."""

import pytest
import sqlite3
import tempfile
import os
from core.db_helpers import get_db_connection, execute_query, execute_update, batch_insert

def test_get_db_connection():
    """Test context manager for DB connection."""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as f:
        db_path = f.name
    
    try:
        with get_db_connection(db_path) as conn:
            conn.execute("CREATE TABLE test (id INTEGER)")
        
        # Verify connection closed
        with pytest.raises(sqlite3.ProgrammingError):
            conn.execute("SELECT 1")
    finally:
        os.unlink(db_path)

def test_execute_query():
    """Test execute_query helper."""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as f:
        db_path = f.name
    
    try:
        with get_db_connection(db_path) as conn:
            conn.execute("CREATE TABLE test (id INTEGER, name TEXT)")
            conn.execute("INSERT INTO test VALUES (1, 'test')")
        
        results = execute_query(db_path, "SELECT * FROM test")
        assert len(results) == 1
        assert results[0]["name"] == "test"
    finally:
        os.unlink(db_path)
```

### Tarea 6.5: Actualizar README Principal

**Archivo:** `README.md`

**Actualizar con:**
- Descripción actualizada del proyecto
- Arquitectura simplificada
- Quick start:
  - Instalar dependencias: `pnpm install`
  - Iniciar AKIRA: `pnpm run akira`
  - Iniciar API: `pnpm run api`
  - Iniciar Antena: `pnpm run antena`
- Links a documentación:
  - Arquitectura: [docs/architecture.md](docs/architecture.md)
  - Esquema de base de datos: [docs/schema.md](docs/schema.md)
  - Guía de troubleshooting: [docs/troubleshooting.md](docs/troubleshooting.md)
- Variables de entorno requeridas:
  - `AKIRA_HOST`
  - `AKIRA_PORT`
  - `AKIRA_DB`
  - `API_PORT`
  - `API_DB_PATH`
  - `API_CORS_ORIGINS`
  - `PUBLIC_API_URL`
  - `MINIMAX_API_KEY`
  - `LM_STUDIO_URL`
- Comandos útiles:
  - `pnpm run akira:debug` para depurar AKIRA
  - `pnpm run api:debug` para depurar API
  - `pnpm run antena:debug` para depurar Antena

### Criterios de Éxito Fase 6

- [ ] Arquitectura documentada en docs/architecture.md
- [ ] Variables de entorno documentadas en .env.example
- [ ] Guía de troubleshooting creada
- [ ] Tests unitarios agregados
- [ ] README principal actualizado
- [ ] Documentación consistente con código actual

---

## FASE 7: BOOST de Antena - UI/UX y Funcionalidades

**Objetivo:** Transformar ANTENA en una PWA de clase mundial con funcionalidades avanzadas, performance optimizado, y UX mejorada.

**Tiempo estimado:** 15-25 horas (3-5 días de trabajo intenso)

**Prioridad:** ALTA

### Estado Actual de ANTENA

**Stack:**
- Astro 5.0 (SSR mode, output: static)
- Solid.js 1.9 (Islands architecture)
- Tailwind CSS 3.4
- Hono API (backend)
- Puerto: 4321

**Funcionalidades Actuales:**
- ✅ Feed de noticias con infinite scroll
- ✅ Filtrado por categoría y ubicación
- ✅ Búsqueda en tiempo real
- ✅ Filtros de tiempo (hora, hoy, semana)
- ✅ Bookmarks en localStorage
- ✅ Vista de artículo con cluster
- ✅ Modo Mate (TTS básico)
- ✅ Tema light/dark/auto
- ✅ Sidebar con estadísticas
- ✅ RightPanel con noticias relacionadas
- ✅ Indicador de sesgo (bias bar)
- ✅ Indicador de señal (signal level)
- ✅ Detección de gacetillas
- ✅ Detección de clickbait
- ✅ Timeline de propagación
- ✅ Compartir (Web Share API)
- ✅ Navegación móvil (bottom nav)

**Funcionalidades FALTANTES (Oportunidades de BOOST):**
- ❌ PWA completo (service worker, offline, install prompt)
- ❌ IndexedDB para cache offline
- ❌ Haptic feedback
- ❌ TTS mejorado con voces, pausa/resume, controles
- ❌ Geolocalización automática
- ❌ Notificaciones push
- ❌ Background sync
- ❌ Pull-to-refresh
- ❌ Skeleton screens mejorados
- ❌ Animaciones y transiciones
- ❌ Gestos (swipe, long press)
- ❌ Accesibilidad mejorada (ARIA, keyboard nav)
- ❌ Performance optimización (lazy loading, code splitting)
- ❌ SEO mejorado (meta tags, structured data)
- ❌ Analytics y tracking
- ❌ Error tracking

### Tarea 7.1: PWA Completo con Vite PWA

**Objetivo:** Implementar PWA completo con service worker, offline mode, install prompt, y app shortcuts.

**Archivos a crear/modificar:**
- `packages/antena/astro.config.mjs` - Agregar Vite PWA plugin
- `packages/antena/public/manifest.json` - Mejorar manifest con shortcuts, screenshots
- `packages/antena/public/icons/` - Crear iconos PWA (192x192, 512x512, maskable, 1024x1024)
- `packages/antena/public/apple-touch-icon.png` - Icono iOS
- `packages/antena/public/offline.html` - Página offline
- `packages/antena/src/components/PWAInstall.tsx` - Componente de install prompt
- `packages/antena/src/layouts/Layout.astro` - Agregar meta tags PWA

**Comandos:**
```bash
cd packages/antena
pnpm add -D vite-plugin-pwa workbox-window idb
```

**Configuración astro.config.mjs:**
```js
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import solidJs from '@astrojs/solid-js';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  integrations: [tailwind(), solidJs()],
  site: 'https://antena.com.ar',
  output: 'static',
  vite: {
    plugins: [
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'offline.html'],
        manifest: {
          name: 'Antena — Sintonizá tu realidad',
          short_name: 'Antena',
          description: 'Noticias hiperlocales de Argentina sintetizadas de múltiples fuentes',
          theme_color: '#F9F6F0',
          background_color: '#F9F6F0',
          display: 'standalone',
          orientation: 'portrait-primary',
          scope: '/',
          start_url: '/',
          icons: [
            { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: '/icons/icon-1024x1024.png', sizes: '1024x1024', type: 'image/png' },
          ],
          shortcuts: [
            {
              name: 'Últimas noticias',
              short_name: 'Últimas',
              description: 'Ver las últimas noticias',
              url: '/?view=feed',
              icons: [{ src: '/icons/shortcut-latest.png', sizes: '96x96' }]
            },
            {
              name: 'Mi ciudad',
              short_name: 'Ciudad',
              description: 'Noticias de tu ciudad',
              url: '/?view=location',
              icons: [{ src: '/icons/shortcut-city.png', sizes: '96x96' }]
            },
            {
              name: 'Guardados',
              short_name: 'Guardados',
              description: 'Ver noticias guardadas',
              url: '/?view=bookmarks',
              icons: [{ src: '/icons/shortcut-bookmarks.png', sizes: '96x96' }]
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/localhost:\d+\/api\/news.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'news-api-cache',
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/.*\.(png|jpg|jpeg|svg|gif|webp)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'image-cache',
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
        devOptions: { enabled: true },
      }),
    ],
  },
});
```

**Verificación:**
```bash
cd packages/antena
pnpm build
pnpm preview
# Verificar que service worker se registra
# Verificar que manifest.json se carga
# Verificar install prompt aparece
```

### Tarea 7.2: IndexedDB para Cache Offline

**Objetivo:** Implementar IndexedDB con idb para cache offline de noticias, settings, y bookmarks.

**Archivos a crear:**
- `packages/antena/src/lib/db.ts` - Wrapper de IndexedDB
- `packages/antena/src/lib/offline.ts` - Lógica offline
- `packages/antena/src/components/ConnectionStatus.tsx` - Banner de conexión

**db.ts:**
```ts
import { openDB, type DBSchema } from 'idb';

interface AntenaDB extends DBSchema {
  news: {
    key: string;
    value: {
      id: string;
      title: string;
      summary: string;
      category: string;
      source: string;
      published_at: string;
      cached_at: number;
    };
    indexes: { 'by-published': string };
  };
  settings: {
    key: string;
    value: { theme: string; city: string; tts_rate: number };
  };
  bookmarks: {
    key: string;
    value: { newsId: string; savedAt: number };
  };
}

const DB_NAME = 'antena-db';
const DB_VERSION = 1;

export async function getDB() {
  return openDB<AntenaDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('news')) {
        const store = db.createObjectStore('news', { keyPath: 'id' });
        store.createIndex('by-published', 'published_at');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('bookmarks')) {
        db.createObjectStore('bookmarks', { keyPath: 'newsId' });
      }
    },
  });
}

export async function cacheNews(news: any[]) {
  const db = await getDB();
  const tx = db.transaction('news', 'readwrite');
  await Promise.all(news.map(item => tx.store.put({ ...item, cached_at: Date.now() })));
  await tx.done;
}

export async function getCachedNews(limit = 20) {
  const db = await getDB();
  return db.getAll('news', undefined, limit);
}
```

**Verificación:**
```bash
# Verificar que IndexedDB se crea
# Verificar que noticias se cachean
# Verificar que offline funciona
```

### Tarea 7.3: Haptic Feedback

**Objetivo:** Implementar haptic feedback para interacciones táctiles en dispositivos móviles.

**Archivos a crear:**
- `packages/antena/src/lib/haptic.ts` - Wrapper de navigator.vibrate

**haptic.ts:**
```ts
export function vibrate(pattern: number | number[] = 15): boolean {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export const HapticPattern = {
  tap: 15,
  success: [15, 50, 15],
  error: [30, 50, 30, 50, 30],
  long: 50,
  double: [15, 100, 15],
} as const;

export function useHaptic() {
  const isSupported = 'vibrate' in navigator;

  return {
    isSupported,
    vibrate: (pattern: keyof typeof HapticPattern | number | number[]) => {
      if (!isSupported) return false;
      const p = typeof pattern === 'string' ? HapticPattern[pattern] : pattern;
      return vibrate(p);
    },
  };
}
```

**Verificación:**
```bash
# Probar en Android Chrome
# Probar en iOS 17.4+
# Verificar que no rompe en desktop
```

### Tarea 7.4: TTS Mejorado

**Objetivo:** Mejorar ModoMate con voces en español, pausa/resume, controles de velocidad, y manejo robusto de iOS.

**Archivos a modificar:**
- `packages/antena/src/components/common/ModoMate.tsx` - Mejorar TTS

**Mejoras:**
- Cargar voces en español automáticamente
- Implementar pausa/resume (con workaround para iOS)
- Controles de velocidad y pitch
- Selector de voz
- Manejo robusto de interacción de usuario (iOS)
- Haptic feedback al iniciar/parar

**Verificación:**
```bash
# Probar en Android Chrome (múltiples voces)
# Probar en iOS 17.4+ (limitaciones)
# Probar pausa/resume
# Probar cambio de velocidad
```

### Tarea 7.5: Geolocalización Automática

**Objetivo:** Implementar geolocalización automática para detectar la ciudad del usuario y filtrar noticias locales.

**Archivos a crear:**
- `packages/antena/src/lib/geolocation.ts` - Wrapper de Geolocation API
- `packages/antena/src/components/LocationPermission.tsx` - Prompt de permiso

**geolocation.ts:**
```ts
export interface LocationData {
  lat: number;
  lng: number;
  accuracy: number;
}

export async function getCurrentLocation(): Promise<LocationData | null> {
  if (!('geolocation' in navigator)) return null;

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000, // 5 minutos cache
      }
    );
  });
}

export async function getLocationName(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
    );
    const data = await res.json();
    return data.address?.city || data.address?.town || data.address?.village || null;
  } catch {
    return null;
  }
}
```

**Verificación:**
```bash
# Probar en móvil con GPS
# Probar permiso denegado
# Probar timeout
```

### Tarea 7.6: Pull-to-Refresh

**Objetivo:** Implementar pull-to-refresh para recargar el feed de noticias.

**Archivos a crear:**
- `packages/antena/src/components/PullToRefresh.tsx` - Componente de pull-to-refresh

**Verificación:**
```bash
# Probar pull-to-refresh en móvil
# Verificar que no afecta desktop
```

### Tarea 7.7: Animaciones y Transiciones

**Objetivo:** Implementar animaciones suaves y transiciones para mejorar la UX.

**Archivos a crear:**
- `packages/antena/src/styles/animations.css` - CSS animations

**Verificación:**
```bash
# Verificar que animaciones son suaves
# Verificar que no afectan performance
```

### Tarea 7.8: Gestos (Swipe, Long Press)

**Objetivo:** Implementar gestos táctiles para acciones rápidas (swipe para guardar, long press para opciones).

**Archivos a crear:**
- `packages/antena/src/lib/gestures.ts` - Gesture recognizer

**Verificación:**
```bash
# Probar swipe left/right
# Probar long press
```

### Tarea 7.9: Optimización de Performance

**Objetivo:** Optimizar performance con lazy loading, code splitting, y virtual scrolling.

**Archivos a modificar:**
- `packages/antena/astro.config.mjs` - Configuración de build
- `packages/antena/src/App.tsx` - Lazy loading de componentes

**Verificación:**
```bash
pnpm build
# Verificar bundle size
# Verificar Lighthouse score
```

### Tarea 7.10: SEO Mejorado

**Objetivo:** Mejorar SEO con meta tags, structured data, y Open Graph.

**Archivos a modificar:**
- `packages/antena/src/layouts/Layout.astro` - Meta tags

**Verificación:**
```bash
# Verificar con Facebook Sharing Debugger
# Verificar con Twitter Card Validator
# Verificar con Rich Results Test
```

### Tarea 7.11: Accesibilidad Mejorada

**Objetivo:** Mejorar accesibilidad con ARIA labels, keyboard navigation, y screen reader support.

**Archivos a modificar:**
- Todos los componentes de ANTENA

**Mejoras generales:**
- Agregar `aria-label` a todos los botones
- Agregar `role` apropiados
- Implementar keyboard navigation
- Agregar `focus-visible` styles
- Agregar `skip-to-content` link
- Usar headings jerárquicos
- Agregar `alt` text a imágenes

**Verificación:**
```bash
# Probar con screen reader (VoiceOver, NVDA)
# Probar keyboard navigation
# Verificar con axe DevTools
```

### Tarea 7.12: Analytics y Error Tracking

**Objetivo:** Implementar analytics (Plausible/Umami) y error tracking (Sentry).

**Archivos a crear:**
- `packages/antena/src/lib/analytics.ts` - Analytics wrapper
- `packages/antena/src/lib/sentry.ts` - Sentry wrapper

**Verificación:**
```bash
# Verificar que eventos se trackean
# Verificar que errores se capturan
```

### Criterios de Éxito Fase 7

- [ ] PWA instalable en móvil
- [ ] Service worker funcionando
- [ ] Offline mode con IndexedDB
- [ ] Haptic feedback en Android/iOS
- [ ] TTS mejorado con voces
- [ ] Geolocalización automática
- [ ] Pull-to-refresh funcionando
- [ ] Animaciones suaves
- [ ] Gestos táctiles funcionando
- [ ] Lighthouse score > 90
- [ ] SEO mejorado con meta tags
- [ ] Accesibilidad WCAG AA
- [ ] Analytics funcionando
- [ ] Error tracking funcionando

---

## Timeline Resumido

| Fase | Descripción | Tiempo | Prioridad |
|------|-------------|--------|-----------|
| 0 | Arreglar problemas críticos de configuración | 1-2h | CRÍTICA |
| 1 | Instalar Hermes skills | 2-4h | CRÍTICA |
| 2 | Limpiar código basura | 1h | ALTA |
| 3 | Refactorizar malas prácticas | 8-12h | ALTA |
| 4 | Consolidar schema | 2-3h | ALTA |
| 5 | Integrar AKIRA → API → Antena | 4-6h | CRÍTICA |
| 6 | Documentación y tests | 2-3h | MEDIA |
| 7 | BOOST de Antena (PWA, UX, Performance) | 15-25h | ALTA |

**Total:** 35-56 horas (5-7 días)

---

## Checklist Final

### Fase 0: Configuración Crítica
- [x] Puerto estandarizado en 5000 (config.py:13)
- [x] Dependencias unificadas (newspaper4k en requirements.txt y pyproject.toml)
- [x] Referencias de directorios actualizadas (docker-compose.yml, ecosystem.config.cjs, tsconfig.json)
- [x] .gitignore reescrito correctamente (73 líneas)
- [ ] Secrets hardcoded eliminados (pendiente: scripts/extract-official-sources.sh, scripts/run_analyst.py, main.py)
- [ ] Archivos basura en raíz eliminados (pendiente: harvest_pulso.py, __pycache__/, .wrangler/, node_modules/)
- [ ] Archivos de build/cache limpiados
- [ ] Configuración verificada

### Fase 1: Hermes
- [ ] Skills copiados a ~/.hermes/skills/
- [ ] Variables de entorno configuradas
- [ ] Cron jobs configurados
- [ ] AKIRA corriendo
- [ ] LM Studio corriendo
- [ ] Pipeline probado manualmente
- [ ] Automatización habilitada

### Fase 2: Limpieza
- [ ] Archivos duplicados eliminados
- [ ] .DS_Store eliminados
- [ ] __pycache__ limpiado
- [ ] .gitignore actualizado
- [ ] Código comentado eliminado

### Fase 3: Refactorización
- [ ] except: reemplazados
- [ ] Variables globales eliminadas
- [ ] Imports al top
- [ ] Context managers agregados
- [ ] DB helpers creados
- [ ] Variables de entorno usadas
- [ ] Dedup unificado
- [ ] Logging estandarizado
- [ ] Tests pasan

### Fase 4: Schema
- [ ] Schema analizado
- [ ] Schema unificado creado
- [ ] Migration script creado
- [ ] Migration ejecutada
- [ ] Schema documentado

### Fase 5: Integración
- [ ] API conectada a DB
- [ ] API endpoints funcionan
- [ ] Antena conectada a API
- [ ] Antena muestra datos
- [ ] Tests de integración creados
- [ ] Tests pasan
- [ ] Flujo completo verificado

### Fase 6: Documentación
- [ ] Arquitectura documentada
- [ ] Variables documentadas
- [ ] Troubleshooting guía creada
- [ ] Tests agregados
- [ ] README actualizado

---

## Notas Importantes

1. **Backup antes de cambios importantes:**
   - Siempre hacer backup de akira.db antes de migrations
   - Usar git branches para cambios grandes

2. **Pruebas incrementales:**
   - Probar cada fase antes de continuar
   - No avanzar si tests fallan

3. **Documentar cambios:**
   - Commits descriptivos
   - Changelog actualizado

4. **Monitoreo:**
   - Verificar logs después de cada cambio
   - Monitorear performance del pipeline

5. **Rollback plan:**
   - Tener backup de DB
   - Tener git commit antes de cada fase
   - Saber cómo revertir cambios

---

## Contacto y Soporte

Para preguntas o problemas durante la implementación:
- Revisar docs/troubleshooting.md
- Revisar logs en /tmp/akira-extractor.log
- Verificar estado de servicios: AKIRA (5000), API (8787), Antena (4321)
