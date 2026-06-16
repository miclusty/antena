#!/usr/bin/env python3
"""
Backfill province for curated-provincial entries.

The original curate_provincial.py had a bug: it always set
province=None, so curated entries weren't associated with any
province. This script updates them based on a known mapping
of curated media → province (or provinces).

Some curated entries cover multiple provinces (e.g., "La Voz"
covers both Córdoba and Buenos Aires; "Radio Mitre" covers
all 24 provinces). For those, we set province to the primary
one and tag the others in the `tags` field.

This is a one-shot data fix. After it runs, coverage stats
will correctly count indirect provincial coverage.
"""

from __future__ import annotations

import argparse
import logging
import os
import sqlite3
import sys
from typing import List, Optional, Tuple


LOGGER = logging.getLogger("akira.media.backfill_curated")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import coverage


# ─── Curated → province mapping ─────────────────────────────
# Maps the display name of the curated entry to its primary
# province (and optionally a list of additional provinces it
# also covers). We use this to backfill the province column
# on entries that were created with province=None.

CURATED_PROVINCES = {
    # ── Nacionales ───────────────────────────────────────────
    "Clarín": (None, []),
    "La Nación": (None, []),
    "Infobae": (None, []),
    "Página/12": (None, []),
    "Ámbito": (None, []),
    "Perfil": (None, []),
    "El Cronista": (None, []),
    "Radio Mitre": (None, []),  # covers all
    "Cadena 3 Argentina": (None, []),
    "Cadena 3 Córdoba": ("Córdoba", []),
    "La 100": (None, []),
    "Radio 10": (None, []),
    "El Destape": (None, []),

    # ── CABA ─────────────────────────────────────────────────
    "Tiempo Argentino": ("Ciudad Autónoma de Buenos Aires", []),
    "Miradas al Sur": ("Ciudad Autónoma de Buenos Aires", []),
    "Noticias Urbanas": ("Ciudad Autónoma de Buenos Aires", []),
    "EnOrsai": ("Ciudad Autónoma de Buenos Aires", []),
    "Línea Capital": ("Ciudad Autónoma de Buenos Aires", []),
    "Revista Noticias": ("Ciudad Autónoma de Buenos Aires", []),
    "Radio La Pizarra": ("Ciudad Autónoma de Buenos Aires", []),

    # ── Buenos Aires ─────────────────────────────────────────
    "La Voz": ("Córdoba", ["Buenos Aires"]),  # primary Córdoba
    "Diario Popular": ("Buenos Aires", []),
    "La Nación Morón": ("Buenos Aires", []),
    "La Mañana de Brandsen": ("Buenos Aires", []),
    "La Verdad": ("Buenos Aires", []),
    "La Mañana de Necochea": ("Buenos Aires", []),
    "Diario El Sur de Bahía Blanca": ("Buenos Aires", []),
    "El Eco de Tandil": ("Buenos Aires", []),
    "Diario La Mañana de Bolívar": ("Buenos Aires", []),
    "El Diario de La Costa": ("Buenos Aires", []),
    "La Voz del Pueblo de Tres Arroyos": ("Buenos Aires", []),
    "El Popular de Olavarría": ("Buenos Aires", []),
    "Nueva Era de Pehuajó": ("Buenos Aires", []),
    "Diario El Tiempo de Azul": ("Buenos Aires", []),
    "La Mañana de Mar del Plata": ("Buenos Aires", []),
    "El Atlántico de Mar del Plata": ("Buenos Aires", []),
    "Radio LU2 de Bahía Blanca": ("Buenos Aires", []),
    "Radio La Brújula de Tres Arroyos": ("Buenos Aires", []),
    "Radio del Mar de Necochea": ("Buenos Aires", []),

    # ── Córdoba ─────────────────────────────────────────────
    "La Voz del Interior": ("Córdoba", []),
    "Los Andes": ("Mendoza", ["Córdoba"]),  # primarily Mendoza
    "Puntal": ("Córdoba", []),
    "Radio Universidad Córdoba": ("Córdoba", []),
    "Radio Mitre Córdoba": ("Córdoba", []),
    "Radio La Red Córdoba": ("Córdoba", []),
    "Radio Universidad Nacional Córdoba": ("Córdoba", []),
    "Radio Villa María": ("Córdoba", []),
    "Diario de Río Cuarto": ("Córdoba", []),
    "Radio Río Cuarto": ("Córdoba", []),
    "El Diario del Centro del País": ("Córdoba", []),
    "La Mañana de Córdoba": ("Córdoba", []),
    "Diario Alfil": ("Córdoba", []),
    "Diario La Mañana de Río Tercero": ("Córdoba", []),

    # ── Santa Fe ─────────────────────────────────────────────
    "La Capital (Rosario)": ("Santa Fe", []),
    "El Litoral": ("Santa Fe", []),
    "Diario Uno Santa Fe": ("Santa Fe", []),
    "Diario Castellanos": ("Santa Fe", []),
    "Aire Libre Radio": ("Santa Fe", []),
    "Radio Mitre Rosario": ("Santa Fe", []),
    "Radio La Red Rosario": ("Santa Fe", []),
    "Diario La Región": ("Santa Fe", []),
    "El Sur de Santa Fe": ("Santa Fe", []),
    "Diario de Rafaela": ("Santa Fe", []),
    "Diario Castellanos de Rafaela": ("Santa Fe", []),
    "Radio La Red Venado Tuerto": ("Santa Fe", []),
    "Diario de Reconquista": ("Santa Fe", []),

    # ── Mendoza ─────────────────────────────────────────────
    "MDZ Online": ("Mendoza", []),
    "El Sol Mendoza": ("Mendoza", []),
    "Diario San Rafael": ("Mendoza", []),
    "Radio Mitre Mendoza": ("Mendoza", []),
    "Diario Mendoza": ("Mendoza", []),
    "El Cuyano": ("Mendoza", []),
    "Radio Nihuil": ("Mendoza", []),
    "El Sureño Mendoza": ("Mendoza", []),

    # ── Tucumán ─────────────────────────────────────────────
    "La Gaceta": ("Tucumán", []),
    "LV7 Radio Tucumán": ("Tucumán", []),
    "Radio Mitre Tucumán": ("Tucumán", []),
    "Radio Universidad Tucumán": ("Tucumán", []),
    "El Siglo de Tucumán": ("Tucumán", []),

    # ── Salta ───────────────────────────────────────────────
    "El Tribuno Salta": ("Salta", []),
    "Informate Salta": ("Salta", []),
    "Radio Mitre Salta": ("Salta", []),
    "Radio Nacional Salta": ("Salta", []),
    "Diario HOY de Salta": ("Salta", []),
    "El Expreso de Salta": ("Salta", []),

    # ── Entre Ríos ──────────────────────────────────────────
    "El Diario de Paraná": ("Entre Ríos", []),
    "Análisis Digital": ("Entre Ríos", []),
    "Radio La Red Paraná": ("Entre Ríos", []),
    "Radio Paraná": ("Entre Ríos", []),
    "La Calle Concordia": ("Entre Ríos", []),

    # ── Misiones ────────────────────────────────────────────
    "El Territorio Misiones": ("Misiones", []),
    "Primera Edición": ("Misiones", []),
    "Radio Mitre Misiones": ("Misiones", []),
    "Radio LT17 Posadas": ("Misiones", []),
    "Misiones OnLine": ("Misiones", []),
    "Noticias del 6": ("Misiones", []),

    # ── Chaco ───────────────────────────────────────────────
    "Diario Chaco": ("Chaco", []),
    "Radio FM Radio del Pueblo": ("Chaco", []),
    "Radio Mitre Chaco": ("Chaco", []),
    "Radio La Red Resistencia": ("Chaco", []),
    "Diario Norte Resistencia": ("Chaco", []),
    "Radio La Voz del Chaco": ("Chaco", []),

    # ── Corrientes ──────────────────────────────────────────
    "El Litoral Corrientes": ("Corrientes", []),
    "La República Corrientes": ("Corrientes", []),
    "Radio Mitre Corrientes": ("Corrientes", []),
    "Radio Dos Corrientes": ("Corrientes", []),

    # ── Jujuy ───────────────────────────────────────────────
    "El Tribuno de Jujuy": ("Jujuy", []),
    "Pregón Jujuy": ("Jujuy", []),
    "Radio Mitre Jujuy": ("Jujuy", []),
    "Radio City Jujuy": ("Jujuy", []),
    "Diario Jujuy al Momento": ("Jujuy", []),

    # ── Neuquén ─────────────────────────────────────────────
    "LM Neuquén": ("Neuquén", []),
    "Río Negro": ("Río Negro", ["Neuquén"]),  # primary Río Negro
    "Radio La Red Neuquén": ("Neuquén", []),
    "Diario Andino": ("Neuquén", []),
    "El Diario del Centro Neuquén": ("Neuquén", []),
    "Radio Nacional Neuquén": ("Neuquén", []),

    # ── Río Negro ───────────────────────────────────────────
    "Río Negro General Roca": ("Río Negro", []),
    "El Cordillerano": ("Río Negro", []),
    "Radio La Red Bariloche": ("Río Negro", []),
    "Bariloche 2000": ("Río Negro", []),

    # ── Chubut ──────────────────────────────────────────────
    "El Patagónico": ("Chubut", []),
    "Diario Jornada": ("Chubut", []),
    "Radio La Red Comodoro": ("Chubut", []),
    "Diario Crónica Comodoro": ("Chubut", []),

    # ── Catamarca ──────────────────────────────────────────
    "El Ancasti": ("Catamarca", []),

    # ── La Rioja ────────────────────────────────────────────
    "El Independiente La Rioja": ("La Rioja", []),
    "Nueva Rioja": ("La Rioja", []),

    # ── San Juan ────────────────────────────────────────────
    "Diario de Cuyo": ("San Juan", []),
    "El Zonda": ("San Juan", []),

    # ── San Luis ────────────────────────────────────────────
    "El Diario de la República": ("San Luis", []),
    "La Gaceta San Luis": ("San Luis", []),

    # ── La Pampa ────────────────────────────────────────────
    "La Arena": ("La Pampa", []),
    "El Diario de La Pampa": ("La Pampa", []),

    # ── Formosa ─────────────────────────────────────────────
    "La Mañana Formosa": ("Formosa", []),

    # ── Santa Cruz ──────────────────────────────────────────
    "La Opinión Austral": ("Santa Cruz", []),
    "El Caletense": ("Santa Cruz", []),

    # ── Tierra del Fuego ────────────────────────────────────
    "El Sureño": ("Tierra del Fuego, Antártida e Islas del Atlántico Sur", []),
    "Diario del Fin del Mundo": (
        "Tierra del Fuego, Antártida e Islas del Atlántico Sur", []
    ),
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Backfill province for curated-provincial entries"
    )
    p.add_argument("--db", default=coverage.DEFAULT_DB)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    conn = coverage.get_connection(args.db)
    updated = 0
    unknown = 0

    for name, (prov, extras) in CURATED_PROVINCES.items():
        # Build new tags
        all_provs = ([prov] if prov else []) + extras
        new_tags = "curated-provincial"
        if all_provs:
            new_tags += f"|provinces={','.join(all_provs)}"

        # Get current row
        row = conn.execute(
            "SELECT id, province, tags FROM argentine_media "
            "WHERE source='curated-provincial' AND name=?",
            (name,),
        ).fetchone()
        if not row:
            LOGGER.debug(f"  {name}: not in DB")
            continue

        current_province = row[1]
        current_tags = row[2] or ""

        # Decide if we need to update
        needs_update = False
        new_province = prov
        if current_province != new_province:
            needs_update = True
        if "provinces=" in new_tags and "provinces=" not in current_tags:
            needs_update = True

        if not needs_update:
            continue

        if args.dry_run:
            print(f"  {name}: {current_province} → {new_province} | tags: {new_tags[:60]}")
        else:
            try:
                conn.execute(
                    "UPDATE argentine_media SET province=?, tags=? "
                    "WHERE id=?",
                    (new_province, new_tags, row[0]),
                )
                updated += 1
                LOGGER.info(f"  {name}: → {new_province}")
            except Exception as e:
                LOGGER.error(f"  {name}: {e}")

    if not args.dry_run:
        conn.commit()

    print(f"\nUpdated: {updated}")
    print(f"Unknown (in map but not in DB): {unknown}")

    # Show stats
    s = coverage.stats(conn)
    print(f"\nTotal coverage: {s['covered_towns']}/{s['total_towns']} ({s['coverage_pct']}%)")

    # Curated by province
    print("\nCurated by province (top 15):")
    for p, c in conn.execute('''
        SELECT COALESCE(province, '(sin province)') AS p, COUNT(*) AS c
        FROM argentine_media
        WHERE source='curated-provincial'
        GROUP BY p ORDER BY c DESC LIMIT 20
    ''').fetchall():
        print(f"  {p:50} {c}")

    # Indirect coverage now
    print("\nIndirect coverage (pueblos con al menos 1 provincial):")
    n_indirect = conn.execute('''
        SELECT COUNT(DISTINCT t.codgl)
        FROM argentine_towns t
        JOIN argentine_media m ON m.province = t.province
        WHERE m.source='curated-provincial' AND m.province IS NOT NULL
    ''').fetchone()[0]
    print(f"  {n_indirect}/{s['total_towns']} ({100*n_indirect//s['total_towns']}%)")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
