"""Radios route.

GET /medios/radios — Live radio directory for the Antena persistent player
and the /radios page. Reads from argentine_media (a separate table from
the news schema).
"""
from fastapi import APIRouter, Request

from db.connection import get_db_connection

router = APIRouter(tags=["radios"])


@router.get("/medios/radios")
async def get_radios(request: Request):
    """Live radio directory.

    Query params:
      - limit: max rows (default 2000, max 5000)
      - codgl: filter to a specific pueblo (5-digit gov-loc code)
      - province: filter to a specific province name
    """
    limit = min(int(request.query_params.get("limit", "2000")), 5000)
    codgl = request.query_params.get("codgl")
    province = request.query_params.get("province")

    where = ["type = 'radio'", "stream_url IS NOT NULL", "stream_url != ''"]
    params: list = []
    if codgl:
        where.append("codgl = ?")
        params.append(codgl)
    if province:
        where.append("LOWER(province) = LOWER(?)")
        params.append(province)

    sql = f"""
        SELECT id, name, stream_url, website, city, province,
               codgl, tags, type, source
        FROM argentine_media
        WHERE {' AND '.join(where)}
        ORDER BY
          CASE WHEN codgl IS NOT NULL THEN 0 ELSE 1 END,
          name ASC
        LIMIT ?
    """
    params.append(limit)
    with get_db_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    items = [dict(r) for r in rows]
    return {"items": items, "total": len(items)}