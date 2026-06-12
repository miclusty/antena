-- Migration: Fix location granularity in sources
-- Task: t_28afc494 (A4: Fix location granularity in sources)
-- Date: 2026-05-05
-- 
-- BEFORE STATE:
--   pais      | 917 sources (all country-level, no granularity)
--   provincia | 121 sources
--   ciudad    | 37 sources
--
-- This migration fixes known Argentine news sources that can be mapped
-- to specific provinces/ciudades based on their editorial HQ.

BEGIN TRANSACTION;

-- La Gaceta (lagaceta.com.ar) → Tucumán (provincia)
-- Two entries exist for the same publication
UPDATE sources SET location_id = (SELECT id FROM locations WHERE name = 'Tucumán' AND type = 'provincia')
WHERE name = 'La Gaceta' AND url LIKE '%lagaceta.com.ar%';

-- Cba24n → Córdoba Capital (ciudad)
UPDATE sources SET location_id = 101
WHERE name = 'Cba24n' AND url = 'https://www.cba24n.com.ar/';

-- Note: 917 sources remain at pais level because:
-- 1. No province column data is populated in sources table
-- 2. Domain/URL does not reliably indicate location for general news sites
-- 3. Many sites are national in scope (infobae, lanacion, clarin)
-- 
-- To fully resolve, would need external research to map each domain to city/province.

COMMIT;

-- VERIFY:
-- SELECT l.type, COUNT(*) as cnt FROM sources s JOIN locations l ON s.location_id = l.id GROUP BY l.type ORDER BY l.type;
