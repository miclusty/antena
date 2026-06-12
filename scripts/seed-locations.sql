-- Sample locations for Argentina (full dataset will be ~2400+ rows)
-- This is a seed with major cities and provinces for Phase 1

-- Provinces
INSERT OR IGNORE INTO locations (id, name, province, lat, lng, type, population, country) VALUES
  (1, 'Argentina', 'Argentina', -34.6037, -58.3816, 'pais', 47000000, 'AR'),
  (2, 'Buenos Aires', 'Buenos Aires', -34.6037, -58.3816, 'provincia', 17500000, 'AR'),
  (3, 'Córdoba', 'Córdoba', -31.4201, -64.1888, 'provincia', 3700000, 'AR'),
  (4, 'Santa Fe', 'Santa Fe', -31.6333, -60.7000, 'provincia', 3400000, 'AR'),
  (5, 'Mendoza', 'Mendoza', -32.8895, -68.8458, 'provincia', 1900000, 'AR'),
  (6, 'Tucumán', 'Tucumán', -26.8083, -65.2176, 'provincia', 1700000, 'AR'),
  (7, 'Entre Ríos', 'Entre Ríos', -31.7333, -60.5293, 'provincia', 1400000, 'AR'),
  (8, 'Salta', 'Salta', -24.7859, -65.4117, 'provincia', 1400000, 'AR'),
  (9, 'Misiones', 'Misiones', -27.3671, -55.8961, 'provincia', 1200000, 'AR'),
  (10, 'Corrientes', 'Corrientes', -27.4692, -58.8306, 'provincia', 1100000, 'AR');

-- Major cities
INSERT OR IGNORE INTO locations (id, name, province, lat, lng, type, population, country) VALUES
  (100, 'CABA', 'Buenos Aires', -34.6037, -58.3816, 'ciudad', 3075000, 'AR'),
  (101, 'Córdoba Capital', 'Córdoba', -31.4201, -64.1888, 'ciudad', 1400000, 'AR'),
  (102, 'Rosario', 'Santa Fe', -32.9442, -60.6505, 'ciudad', 1200000, 'AR'),
  (103, 'Mendoza Capital', 'Mendoza', -32.8895, -68.8458, 'ciudad', 115000, 'AR'),
  (104, 'San Miguel de Tucumán', 'Tucumán', -26.8083, -65.2176, 'ciudad', 900000, 'AR'),
  (105, 'La Plata', 'Buenos Aires', -34.9215, -57.9545, 'ciudad', 800000, 'AR'),
  (106, 'Mar del Plata', 'Buenos Aires', -38.0055, -57.5426, 'ciudad', 650000, 'AR'),
  (107, 'Salta Capital', 'Salta', -24.7859, -65.4117, 'ciudad', 620000, 'AR'),
  (108, 'Santa Fe Capital', 'Santa Fe', -31.6333, -60.7000, 'ciudad', 550000, 'AR'),
  (109, 'San Juan Capital', 'San Juan', -31.5375, -68.5364, 'ciudad', 500000, 'AR'),
  (110, 'Resistencia', 'Chaco', -27.4514, -58.9867, 'ciudad', 400000, 'AR'),
  (111, 'Posadas', 'Misiones', -27.3671, -55.8961, 'ciudad', 350000, 'AR'),
  (112, 'Neuquén Capital', 'Neuquén', -38.9516, -68.0591, 'ciudad', 350000, 'AR'),
  (113, 'Bahía Blanca', 'Buenos Aires', -38.7183, -62.2663, 'ciudad', 320000, 'AR'),
  (114, 'Paraná', 'Entre Ríos', -31.7333, -60.5293, 'ciudad', 280000, 'AR'),
  (115, 'Corrientes Capital', 'Corrientes', -27.4692, -58.8306, 'ciudad', 360000, 'AR');
