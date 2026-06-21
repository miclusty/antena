"""Routes package for AKIRA.

Each module in this package owns a slice of the public API:
  - feed.py:       /api/news/* (feed, blindspot, by-id, cluster)
  - categories.py: /api/categories
  - locations.py:  /api/locations, /api/locations/tree

Routes are wired into the FastAPI app in main.py via `app.include_router()`.
"""