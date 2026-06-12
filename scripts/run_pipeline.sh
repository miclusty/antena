#!/bin/bash
set -e
echo "=== AKIRA Pipeline ==="
echo "[1/4] Harvesting..."
python /Users/omatic/proyectos/news/harvest_pulso.py
echo "[2/4] Analyzing..."
python /Users/omatic/proyectos/news/scripts/run_analyst.py
echo "[3/4] Cleaning..."
python /Users/omatic/proyectos/news/scripts/run_cleaner.py
echo "[4/4] Publishing..."
python /Users/omatic/proyectos/news/scripts/run_publisher.py
echo "=== Done ==="