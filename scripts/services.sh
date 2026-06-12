#!/bin/bash
# AKIRA Service Manager
# Uso: ./scripts/services.sh [start|stop|restart|status|logs|monit]

case "${1:-status}" in
  start)
    echo "🚀 Starting AKIRA services..."
    pm2 start ecosystem.config.cjs
    sleep 3
    pm2 list
    echo ""
    echo "✅ Services:"
    echo "   AKIRA: http://localhost:5000/health"
    echo "   API:   http://localhost:8787/api/health"
    echo "   Web:   http://localhost:4321"
    ;;
  
  stop)
    echo "🛑 Stopping AKIRA services..."
    pm2 stop all
    ;;
  
  restart)
    echo "🔄 Restarting AKIRA services..."
    pm2 restart all
    ;;
  
  status)
    pm2 list
    echo ""
    echo "📊 Memory:"
    pm2 list --mini-list
    ;;
  
  logs)
    pm2 logs "${2:-all}" --lines 50
    ;;
  
  monit)
    pm2 monit
    ;;
  
  *)
    echo "Usage: $0 {start|stop|restart|status|logs [service]|monit}"
    echo ""
    echo "Examples:"
    echo "  $0 start          # Start all services"
    echo "  $0 stop           # Stop all services"
    echo "  $0 restart        # Restart all services"
    echo "  $0 status         # Show status"
    echo "  $0 logs           # Show all logs"
    echo "  $0 logs akira     # Show AKIRA logs only"
    echo "  $0 monit          # Interactive monitor"
    ;;
esac
