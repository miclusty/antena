#!/bin/bash
# AKIRA - Start all services
# One script to rule them all

set -e

PROJECT_DIR="/Users/omatic/proyectos/news"

echo "🚀 Starting AKIRA..."
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Kill existing processes on ports
echo "🧹 Cleaning up..."
lsof -ti:8787 | xargs kill 2>/dev/null || true
lsof -ti:4321 | xargs kill 2>/dev/null || true

sleep 1

# Start API in background
echo -e "${BLUE}📡 Starting API (port 8787)...${NC}"
cd "$PROJECT_DIR/packages/api" && pnpm dev > /tmp/akira-api.log 2>&1 &
API_PID=$!

# Start Web in background  
echo -e "${BLUE}🌐 Starting Web (port 4321)...${NC}"
cd "$PROJECT_DIR/packages/antena" && pnpm dev > /tmp/akira-web.log 2>&1 &
WEB_PID=$!

# Wait for services to start
echo ""
echo "⏳ Waiting for services..."
sleep 5

# Check status
echo ""
echo "═══════════════════════════════════════════"
echo -e "${GREEN}   AKIRA - Hyperlocal News Platform${NC}"
echo "═══════════════════════════════════════════"
echo ""

# Check API
if curl -s http://localhost:8787/api/health | grep -q "ok"; then
  echo -e "${GREEN}✅ API:${NC} http://localhost:8787"
else
  echo "⚠️  API: Starting..."
fi

# Check Web
if curl -s -o /dev/null -w "%{http_code}" http://localhost:4321 | grep -q "200"; then
  echo -e "${GREEN}✅ Web:${NC} http://localhost:4321"
else
  echo "⚠️  Web: Starting..."
fi

echo ""
echo "📊 Database: $HOME/data/akira.db"
echo "📝 Logs: /tmp/akira-{api,web}.log"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Store PIDs for cleanup
echo "$API_PID $WEB_PID" > /tmp/akira-pids

# Wait for processes
wait
