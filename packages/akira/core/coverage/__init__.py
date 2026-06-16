"""
Argentine national media coverage.

This module centralizes everything needed to discover and track
local media (radios, newspapers, social) for every pueblo >4000
habitantes in Argentina. The data lives in two tables:

  - argentine_towns:    INDEC Codigo de Gobierno Local → name/province/pop
  - argentine_media:    name/type/city/province/website/stream/facebook/ig

Both tables are populated by scripts in scripts/media/ and consumed
by the extractor pipeline (see extractors/).
"""

from __future__ import annotations

import os
import sqlite3
from typing import Dict, List, Optional, Tuple

DEFAULT_DB = os.getenv(
    "AKIRA_DB_PATH",
    "/Users/omatic/proyectos/news/packages/akira/data/akira.db",
)

# ─── City aliases ────────────────────────────────────────────────
# Some pueblos in INDEC's gobierno local catalog appear under a
# different name in radio station databases. For example, Radio
# Garden lists stations in "Mendoza" while the pueblo is actually
# "Guaymallén" (a partido of the Gran Mendoza aglomerado). Same for
# many GBA suburbs that are listed under the partido's cabecera
# ("Ramos Mejía" is in "La Matanza", etc).
#
# Format: ALIAS_KEY[bigger_name] = list_of_smaller_names_that_resolve_to_it
# The matching is symmetric in practice: when we have a town with
# the bigger name and encounter a radio with the smaller name, we
# assign the radio to the bigger town's codgl. When we have the
# smaller town and encounter a radio with the bigger name, we
# assign the radio to the smaller town (since it's a more
# specific match).

# Gran Buenos Aires: suburban partidos are listed under the GBA
# cabecera in Radio Garden. Reverse: when a radio says "Buenos
# Aires" we keep its codgl as NULL (national) and don't auto-assign
# to any single partido.
GBA_CABECERAS = {
    "La Matanza", "Quilmes", "Lanús", "Avellaneda", "Lomas de Zamora",
    "Tres de Febrero", "General San Martín", "Vicente López",
    "San Isidro", "San Fernando", "Tigre", "Malvinas Argentinas",
    "Morón", "Hurlingham", "Ituzaingó", "Merlo", "Moreno",
    "Florencio Varela", "Berazategui", "Almirante Brown",
    "Esteban Echeverría", "Ezeiza", "Presidente Perón", "Cañuelas",
    "San Vicente", "Marcos Paz", "General Rodríguez",
    "Pilar", "Exaltación de la Cruz", "José C. Paz", "San Miguel",
    "Escobar",
}

CITY_ALIASES: Dict[str, List[str]] = {
    # Gran Mendoza aglomerado
    "Mendoza": ["Guaymallén", "Las Heras", "Godoy Cruz", "Luján de Cuyo",
                "Maipú", "San Martín", "Rivadavia", "Junín", "Capital"],
    # Gran Catamarca
    "San Fernando del Valle de Catamarca": ["Capital", "Catamarca", "San Isidro", "San José"],
    # Gran San Salvador de Jujuy
    "San Salvador de Jujuy": ["Palpalá", "El Carmen", "Yala", "San Pedro de Jujuy"],
    # Gran Paraná
    "Paraná": ["San Benito", "Crespo", "Oro Verde", "San Agustín",
                "Colonia Avellaneda"],
    # Gran Rosario
    "Rosario": ["Granadero Baigorria", "San Lorenzo", "Funes", "Pérez",
                "Soldini", "Fray Luis Beltrán", "Capitán Bermúdez",
                "Granadero Baigorria", "Puerto General San Martín",
                "Villa Gobernador Gálvez", "Alvear", "Pueblo Muñoz",
                "Acebal"],
    # Gran Córdoba
    "Córdoba": ["Río Ceballos", "La Calera", "Villa Allende",
                "Mendiolaza", "Unquillo", "La Falda",
                "Villa Carlos Paz", "Carlos Paz", "Cosquín",
                "Río Segundo", "Río Tercero"],
    # Gran Resistencia
    "Resistencia": ["Fontana", "Barranqueras", "Puerto Vilelas",
                    "Puerto Tirol"],
    # Gran Posadas
    "Posadas": ["Garupá", "Candelaria", "Fachinal", "Apóstoles"],
    # Gran Neuquén
    "Neuquén": ["Plottier", "Centenario", "San Patricio del Chañar",
                "Cipolletti", "Río Negro", "Allen"],
    # Gran San Miguel de Tucumán
    "San Miguel de Tucumán": ["Yerba Buena", "Tafí Viejo", "Banda del Río Salí",
                                "Alderetes", "Las Talitas", "El Manantial",
                                "Lules", "Famaillá"],
    # Gran Salta
    "Salta": ["San Lorenzo", "Cerrillos", "Vaqueros", "La Caldera",
              "Cafayate", "Tartagal", "Metán"],
    # Buenos Aires aglomerado
    "La Matanza": ["Ramos Mejía", "Don Torcuato", "Villa Luzuriaga",
                    "San Justo", "Tablada", "Lomas del Mirador",
                    "Aldo Bonzi", "Tapiales", "Villa Madero",
                    "González Catán", "Virrey del Pino", "Ciudad Evita",
                    "Isidro Casanova", "Laferrere", "Gregorio de Laferrere"],
    "Quilmes": ["Berazategui", "Florencio Varela", "Ezpeleta"],
    "Lanús": ["Banfield", "Lomas de Zamora"],
    "Avellaneda": ["Dock Sud", "Gerli", "Piñeyro", "Sarandí", "Wilde"],
    "San Isidro": ["Beccar", "Boulogne", "Acassuso", "Martínez", "La Lucila"],
    "Vicente López": ["Florida", "Olivos", "Munro", "Carapachay", "Villa Adelina",
                       "La Lucila"],
    "Tres de Febrero": ["Caseros", "El Libertador", "El Talar", "Martín Coronado",
                         "Pablo Podestá", "Santos Lugares", "Churruca", "Ciudadela"],
    "Tigre": ["Don Torcuato", "El Talar", "General Pacheco", "Rincón de Milberg",
              "Nordelta", "Benavídez"],
    "San Miguel": ["Bella Vista", "Muñiz", "San Andrés", "Los Polvorines",
                    "Pablo Nogués"],
    "Bahía Blanca": ["Bahía Blanca", "Punta Alta", "Ingeniero White",
                      "Cerri", "General Cerri"],
    "General Pueyrredón": ["Mar del Plata", "Miramar", "Batán"],
    "Comodoro Rivadavia": ["Comodoro Rivadavia", "Rada Tilly", "Caleta Olivia",
                            "Pico Truncado", "Las Heras"],
    "San Carlos de Bariloche": ["Bariloche", "San Carlos de Bariloche",
                                  "Villa La Angostura", "El Bolsón",
                                  "Dina Huapi"],
    "Río Gallegos": ["Río Gallegos", "Pico Truncado"],
    "Ushuaia": ["Ushuaia", "Río Grande", "Tolhuin"],
    "San Nicolás de los Arroyos": ["San Nicolás"],
    "Pico Truncado": ["Pico Truncado", "Caleta Olivia", "Las Heras",
                       "Puerto Deseado", "Puerto San Julián"],
    "Cañuelas": ["Cañuelas"],
    "Mercedes": ["Mercedes"],
    "Pergamino": ["Pergamino"],
    "Junín": ["Junín"],
    "Tandil": ["Tandil"],
    "Olavarría": ["Olavarría"],
    "Necochea": ["Necochea", "Quequén"],
    "Tres Arroyos": ["Tres Arroyos"],
    "Pehuajó": ["Pehuajó"],
    "General Alvear": ["General Alvear, Mendoza", "General Alvear, Buenos Aires"],
    "San Rafael": ["San Rafael", "Malargüe", "San Carlos"],
    "Gualeguaychú": ["Gualeguaychú", "Pueblo Belgrano", "Urdinarrain"],
    "Concordia": ["Concordia", "Federación"],
    "Salto": ["Salto"],
    "Chivilcoy": ["Chivilcoy", "Veinticinco de Mayo", "Nueve de Julio"],
    "Coronel Pringles": ["Coronel Pringles", "Pigüé", "Coronel Suárez"],
    "Bolívar": ["Bolívar", "Henderson"],
    "Dolores": ["Dolores", "San Clemente del Tuyú", "Santa Teresita",
                 "Las Toninas", "Mar del Tuyú", "Pinamar", "Villa Gesell"],
    "Maipú": ["Maipú"],
    # GBA partidos — Radio Garden often lists suburbs as
    # independent place names. We map them to the corresponding
    # partido (cabezera) so the radio is associated with the
    # correct gobierno local, not a generic "Buenos Aires".
    "La Matanza": ["Ramos Mejía", "San Justo", "Tablada",
                    "Lomas del Mirador", "Aldo Bonzi", "Tapiales",
                    "Villa Madero", "González Catán", "Virrey del Pino",
                    "Ciudad Evita", "Isidro Casanova", "Laferrere",
                    "Gregorio de Laferrere", "Villa Luzuriaga"],
    "Tres de Febrero": ["Caseros", "El Libertador", "Martín Coronado",
                         "Pablo Podestá", "Santos Lugares", "Churruca",
                         "Ciudadela", "Villa Bosch"],
    "General San Martín": ["San Martín", "Chacarita", "Villa Ballester",
                            "José León Suárez", "Los Polvorines",
                            "Billinghurst", "Villa Lynch", "Muñiz",
                            "San Andrés", "Villa Maipú"],
    "Tigre": ["Don Torcuato", "El Talar", "General Pacheco",
              "Rincón de Milberg", "Nordelta", "Benavídez",
              "Ricardo Rojas", "Troncos del Talar"],
    "San Isidro": ["Beccar", "Boulogne", "Acassuso", "Martínez",
                    "La Lucila", "Victoria"],
    "San Miguel": ["Bella Vista", "Muñiz"],
    "Vicente López": ["Florida", "Olivos", "Munro", "Carapachay",
                       "Villa Adelina", "Florida Oeste"],
    "Lanús": ["Banfield", "Lomas de Zamora", "Lanús", "Remedios de Escalada",
              "Valentín Alsina"],
    "Avellaneda": ["Dock Sud", "Gerli", "Piñeyro", "Sarandí", "Wilde",
                    "Avellaneda", "Piñeyro"],
    "Quilmes": ["Quilmes", "Berazategui", "Florencio Varela", "Ezpeleta"],
    "Lomas de Zamora": ["Lomas de Zamora", "Temperley", "Adrogué",
                        "Llavallol", "Turdera"],
    "Hurlingham": ["Hurlingham", "Villa Tesei", "William Morris"],
    "Ituzaingó": ["Ituzaingó"],
    "Morón": ["Morón", "Haedo", "El Palomar", "Castelar"],
}


def normalize(s: str) -> str:
    """Lowercase + strip accents for fuzzy name comparison.

    Maps á→a, é→e, etc. We do NOT collapse spaces because some
    towns have intentional double-spaces or accented separators.
    """
    if not s:
        return ""
    return (
        s.lower()
        .strip()
        .replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
        .replace("ñ", "n")
        .replace("ü", "u")
    )


def build_alias_index(towns: Dict[str, Tuple[str, str, int]]) -> Dict[str, str]:
    """Build a flat index: normalized_name → normalized_bigger_name.

    For each alias pair (big ↔ small), we record the bigger name as
    the canonical. The bigger name is also added as a self-alias.

    For towns that are in GBA_CABECERAS, we keep them independent
    (no aliasing) because Radio Garden lists them under "Buenos
    Aires" cabecera which is too broad to auto-assign to a single
    partido.
    """
    idx: Dict[str, str] = {}
    for big, smalls in CITY_ALIASES.items():
        big_n = normalize(big)
        if big_n in towns:
            idx[big_n] = big_n
            for s in smalls:
                s_n = normalize(s)
                if s_n in towns:
                    idx[s_n] = big_n
    return idx


# ─── Database helpers ────────────────────────────────────────────

def get_connection(db_path: str = DEFAULT_DB) -> sqlite3.Connection:
    """Open a connection with WAL + foreign keys. Reuse the standard
    AKIRA SQLite path so the rest of the system can read it."""
    conn = sqlite3.connect(db_path, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    # Wait up to 30s for the write lock instead of failing
    # immediately. The other long-running scripts (rag_synthesize,
    # link_to_sources) hold write transactions for seconds at a
    # time; this lets our writers wait them out.
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def load_towns(conn: sqlite3.Connection) -> Dict[str, Tuple[str, str, str, int]]:
    """Return {normalized_name: (name, province, codgl, population)}.

    The codgl is a 6-digit zero-padded government code (INDEC).
    """
    rows = conn.execute(
        "SELECT name, province, codgl, population FROM argentine_towns"
    ).fetchall()
    return {normalize(r[0]): (r[0], r[1], r[2], r[3]) for r in rows}


def towns_without_coverage(conn: sqlite3.Connection) -> List[Tuple[str, str, int]]:
    """Return towns (name, codgl, population) with no media entry yet.

    Used by the discovery scripts to prioritize the 600+ pueblos
    that random-radio couldn't cover. Ordered by population desc
    so we hit the most-impactful ones first.
    """
    return conn.execute("""
        SELECT t.name, t.codgl, t.population
        FROM argentine_towns t
        LEFT JOIN argentine_media m ON t.codgl = m.codgl
        WHERE m.id IS NULL
        ORDER BY t.population DESC
    """).fetchall()


def import_radio(
    conn: sqlite3.Connection,
    *,
    name: str,
    type: str,
    city: str,
    province: Optional[str],
    codgl: Optional[str],
    website: Optional[str],
    stream_url: Optional[str] = None,
    facebook_url: Optional[str] = None,
    instagram_url: Optional[str] = None,
    tags: Optional[str] = None,
    source: str = "manual",
) -> bool:
    """Insert one media entry, deduplicated by (name, city, type).

    Returns True if inserted, False if it was a duplicate. The
    UNIQUE constraint is enforced by the schema, so concurrent
    inserts are safe — the loser will get IntegrityError.
    """
    try:
        conn.execute(
            """
            INSERT INTO argentine_media
                (name, type, city, province, codgl, website,
                 stream_url, facebook_url, instagram_url, tags, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, type, city, province, codgl, website,
             stream_url, facebook_url, instagram_url, tags, source),
        )
        return True
    except sqlite3.IntegrityError:
        return False


def stats(conn: sqlite3.Connection) -> Dict:
    """Return coverage stats for diagnostics."""
    total_towns = conn.execute("SELECT COUNT(*) FROM argentine_towns").fetchone()[0]
    covered = conn.execute(
        "SELECT COUNT(DISTINCT codgl) FROM argentine_media WHERE codgl IS NOT NULL"
    ).fetchone()[0]
    by_type = dict(conn.execute(
        "SELECT type, COUNT(*) FROM argentine_media GROUP BY type"
    ).fetchall())
    by_province = dict(conn.execute(
        "SELECT province, COUNT(*) FROM argentine_media GROUP BY province"
    ).fetchall())
    by_source = dict(conn.execute(
        "SELECT source, COUNT(*) FROM argentine_media GROUP BY source"
    ).fetchall())
    return {
        "total_towns": total_towns,
        "covered_towns": covered,
        "coverage_pct": round(100 * covered / max(total_towns, 1), 1),
        "by_type": by_type,
        "by_province": by_province,
        "by_source": by_source,
    }
