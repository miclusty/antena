#!/usr/bin/env python3
"""
Curate a list of major Argentine media per province.

The 67% pueblo coverage we have from random-radio + GNews hits
a ceiling because small pueblos (<30K) don't have their own
dedicated media. But they DO have PROVINCIAL media that covers
news for all pueblos in the province (e.g., "La Voz del Interior"
in Córdoba covers Río Cuarto, Villa Carlos Paz, etc.).

This script adds ~50 hand-picked major Argentine media to
argentine_media with a `covers_provinces` scope. When AKIRA
scrapes these sources, articles get tagged with the pueblo they
mention (via the existing location detection), which means
small pueblos will start showing up in feeds with the right
attribution.

Media are stored with codgl=NULL and a JSON tag listing the
provinces they cover. The stats() function in coverage/ can
optionally count these as "indirect coverage" for pueblo-level
stats.

CLI:
    --db PATH       AKIRA sqlite
    --dry-run       Show what would be added
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import coverage


LOGGER = logging.getLogger("akira.media.curate_provincial")


# ─── Curated list of major Argentine media ─────────────────────
# Each entry: (display_name, type, website, rss_url, provinces[])
# provinces is a list of province names (matching the values
# in argentine_towns.province).
#
# Selection criteria:
#   1. Each province should have at least 1-2 entries that are
#      specifically known to cover it. National outlets (Clarín,
#      La Nación) cover all provinces but with low locality.
#   2. Provincial outlets (La Voz del Interior in Córdoba, El
#      Litoral in Santa Fe) cover many pueblos within their
#      province and are the most impactful for coverage.
#   3. Major regional radios (Cadena 3, Radio Mitre) are listed
#      under the "national" bucket since they broadcast to many
#      provinces simultaneously.

PROVINCIAL_MEDIA = [
    # ── Nacionales (cubren todo el país) ────────────────────
    ("Clarín", "diario", "https://www.clarin.com", "https://www.clarin.com/rss/"),
    ("La Nación", "diario", "https://www.lanacion.com.ar", "https://www.lanacion.com.ar/arc/outboundfeeds/rss/"),
    ("Infobae", "diario", "https://www.infobae.com", "https://www.infobae.com/feeds/"),
    ("Página/12", "diario", "https://www.pagina12.com.ar", "https://www.pagina12.com.ar/feed"),
    ("Ámbito", "diario", "https://www.ambito.com", "https://www.ambito.com/rss/"),
    ("Perfil", "diario", "https://www.perfil.com", "https://www.perfil.com/feed/"),
    ("El Cronista", "diario", "https://www.cronista.com", "https://www.cronista.com/rss/"),
    ("Radio Mitre", "radio", "https://radiomitre.cienradios.com", "https://radiomitre.cienradios.com/feed/"),
    ("Cadena 3 Argentina", "radio", "https://www.cadena3.com", "https://www.cadena3.com/feed/"),
    ("Cadena 3 Córdoba", "radio", "https://www.cadena3.com.ar", "https://www.cadena3.com.ar/feed/"),
    ("La 100", "radio", "https://la100.cienradios.com", "https://la100.cienradios.com/feed/"),
    ("Radio 10", "radio", "https://radio10.com.ar", "https://radio10.com.ar/feed/"),
    ("El Destape", "diario", "https://www.eldestapeweb.com", "https://www.eldestapeweb.com/feed"),

    # ── Buenos Aires (provincia + 14 GBA partidos ya cubiertos) ─
    ("La Voz", "diario", "https://www.lavoz.com.ar", "https://www.lavoz.com.ar/rss/"),  # cubre BA y CBA
    ("Diario Popular", "diario", "https://www.diariopopular.com.ar", "https://www.diariopopular.com.ar/feed"),
    ("La Nación Morón", "diario", "https://www.lanacion.com.ar", None),
    ("La Mañana de Brandsen", "diario", "http://www.lamañanadebrandsen.com.ar", None),
    ("La Verdad", "diario", "https://www.laverdadonline.com", "https://www.laverdadonline.com/feed"),

    # ── Córdoba ────────────────────────────────────────────
    ("La Voz del Interior", "diario", "https://www.lavoz.com.ar", "https://www.lavoz.com.ar/rss/"),
    ("Los Andes", "diario", "https://www.losandes.com.ar", "https://www.losandes.com.ar/rss/"),
    ("Puntal", "diario", "https://www.puntal.com.ar", "https://www.puntal.com.ar/rss/"),
    ("Radio Universidad Córdoba", "radio", "https://radiouniversidad.unr.edu.ar", None),

    # ── Santa Fe ───────────────────────────────────────────
    ("La Capital (Rosario)", "diario", "https://www.lacapital.com.ar", "https://www.lacapital.com.ar/rss"),
    ("El Litoral", "diario", "https://www.ellitoral.com", "https://www.ellitoral.com/index.xml"),
    ("Diario Uno Santa Fe", "diario", "https://www.diariouno.com.ar", "https://www.diariouno.com.ar/feed"),
    ("Diario Castellanos", "diario", "https://www.diariocastellanos.com.ar", None),
    ("Aire Libre Radio", "radio", "http://airelibre.org.ar", None),

    # ── Mendoza ────────────────────────────────────────────
    ("MDZ Online", "diario", "https://www.mdzol.com", "https://www.mdzol.com/feed/"),
    ("El Sol Mendoza", "diario", "https://www.elsol.com.ar", "https://www.elsol.com.ar/feed/"),
    ("Diario San Rafael", "diario", "https://www.diariosanrafael.com.ar", None),

    # ── Tucumán ────────────────────────────────────────────
    ("La Gaceta", "diario", "https://www.lagaceta.com.ar", "https://www.lagaceta.com.ar/rss/"),
    ("LV7 Radio Tucumán", "radio", "https://lv7.com", None),

    # ── Salta ───────────────────────────────────────────────
    ("El Tribuno Salta", "diario", "https://www.eltribuno.com", "https://www.eltribuno.com/feed/"),
    ("Informate Salta", "diario", "https://informatesalta.com.ar", None),

    # ── Entre Ríos ─────────────────────────────────────────
    ("El Diario de Paraná", "diario", "https://www.eldiario.com.ar", "https://www.eldiario.com.ar/rss/"),
    ("Análisis Digital", "diario", "https://www.analisisdigital.com.ar", "https://www.analisisdigital.com.ar/feed"),

    # ── Misiones ────────────────────────────────────────────
    ("El Territorio Misiones", "diario", "https://www.elterritorio.com.ar", "https://www.elterritorio.com.ar/rss/"),
    ("Primera Edición", "diario", "https://www.primeraedicion.com.ar", "https://www.primeraedicion.com.ar/feed"),

    # ── Chaco ───────────────────────────────────────────────
    ("Diario Chaco", "diario", "https://www.diariochaco.com", "https://www.diariochaco.com/feed/"),
    ("Radio FM Radio del Pueblo", "radio", "https://radios.com.ar", None),

    # ── Corrientes ─────────────────────────────────────────
    ("El Litoral Corrientes", "diario", "https://www.ellitoral.com.ar", "https://www.ellitoral.com.ar/feed/"),
    ("La República Corrientes", "diario", "https://www.republica.com.ar", "https://www.republica.com.ar/feed/"),

    # ── Jujuy ───────────────────────────────────────────────
    ("El Tribuno de Jujuy", "diario", "https://www.eltribunodejujuy.com", "https://www.eltribunodejujuy.com/feed/"),
    ("Pregón Jujuy", "diario", "https://www.pregon.com.ar", "https://www.pregon.com.ar/feed/"),

    # ── Neuquén ────────────────────────────────────────────
    ("LM Neuquén", "diario", "https://www.lmneuquen.com.ar", "https://www.lmneuquen.com.ar/feed/"),
    ("Río Negro", "diario", "https://www.rionegro.com.ar", "https://www.rionegro.com.ar/feed/"),

    # ── Río Negro ───────────────────────────────────────────
    ("Río Negro General Roca", "diario", "https://www.rionegro.com.ar", "https://www.rionegro.com.ar/feed/"),
    ("El Cordillerano", "diario", "https://www.elcordillerano.com.ar", None),

    # ── Chubut ──────────────────────────────────────────────
    ("El Patagónico", "diario", "https://www.elpatagonico.com", "https://www.elpatagonico.com/feed/"),
    ("Diario Jornada", "diario", "https://www.diariojornada.com.ar", "https://www.diariojornada.com.ar/feed/"),

    # ── Catamarca ──────────────────────────────────────────
    ("El Ancasti", "diario", "https://www.elancasti.com.ar", "https://www.elancasti.com.ar/feed/"),

    # ── La Rioja ────────────────────────────────────────────
    ("El Independiente La Rioja", "diario", "https://www.elindependiente.com.ar", "https://www.elindependiente.com.ar/feed/"),
    ("Nueva Rioja", "diario", "https://www.nuevarioja.com.ar", "https://www.nuevarioja.com.ar/feed/"),

    # ── San Juan ────────────────────────────────────────────
    ("Diario de Cuyo", "diario", "https://www.diariodecuyo.com.ar", "https://www.diariodecuyo.com.ar/rss/"),
    ("El Zonda", "diario", "https://www.elzonda.com.ar", None),

    # ── San Luis ────────────────────────────────────────────
    ("El Diario de la República", "diario", "https://www.eldiarioderepublica.com.ar", "https://www.eldiarioderepublica.com.ar/feed/"),
    ("La Gaceta San Luis", "diario", "https://www.lagacetasanluis.com", None),

    # ── La Pampa ────────────────────────────────────────────
    ("La Arena", "diario", "https://www.laarena.com.ar", "https://www.laarena.com.ar/feed/"),
    ("El Diario de La Pampa", "diario", "https://www.eldiariodelapampa.com.ar", "https://www.eldiariodelapampa.com.ar/feed/"),

    # ── Formosa ─────────────────────────────────────────────
    ("La Mañana Formosa", "diario", "https://www.lamañanaonline.com", "https://www.lamañanaonline.com/feed/"),

    # ── Santa Cruz ──────────────────────────────────────────
    ("La Opinión Austral", "diario", "https://laopinionaustral.com.ar", "https://laopinionaustral.com.ar/feed/"),
    ("El Caletense", "diario", "https://www.elcaletense.net", None),

    # ── Tierra del Fuego ────────────────────────────────────
    ("El Sureño", "diario", "https://www.elsureno.com.ar", "https://www.elsureno.com.ar/feed/"),
    ("Diario del Fin del Mundo", "diario", "https://www.eldiariodelfindelmundo.com", None),
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Curate provincial media for AKIRA harvesting"
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

    # Build known websites to dedup
    known: set[str] = set()
    for r in conn.execute(
        "SELECT website FROM argentine_media WHERE website IS NOT NULL"
    ).fetchall():
        if r[0]:
            import re
            from urllib.parse import urlparse
            netloc = urlparse(r[0]).netloc.lower()
            netloc = re.sub(r"^www\.", "", netloc)
            if netloc:
                known.add(netloc)

    inserted = 0
    skipped = 0

    for entry in PROVINCIAL_MEDIA:
        if len(entry) == 4:
            name, mtype, website, rss_url = entry
            provinces = []  # nacional (covers all)
        else:
            name, mtype, website, rss_url, provinces = entry

        if not website:
            continue

        # Dedup by domain
        import re
        from urllib.parse import urlparse
        netloc = urlparse(website).netloc.lower()
        netloc = re.sub(r"^www\.", "", netloc)

        if netloc in known:
            skipped += 1
            continue

        # Build tags
        tags = "curated-provincial"
        if provinces:
            tags += f"|provinces={','.join(provinces)}"

        if args.dry_run:
            print(f"  + {name} ({mtype}) | {website} | {provinces}")
            inserted += 1
            continue

        ok = coverage.import_radio(
            conn,
            name=name,
            type=mtype,
            city="Argentina" if not provinces else provinces[0],
            province=None,
            codgl=None,
            website=website,
            stream_url=None,
            tags=tags,
            source="curated-provincial",
        )
        if ok:
            inserted += 1
            known.add(netloc)
            LOGGER.info("  + %s | %s", name, website)
        else:
            skipped += 1

    if not args.dry_run:
        conn.commit()

    print(f"\nInserted: {inserted}, skipped: {skipped}")
    s = coverage.stats(conn)
    print(f"Total media: {sum(s['by_type'].values())}")
    print(f"By type: {s['by_type']}")
    print(f"By source: {s['by_source']}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
