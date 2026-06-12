-- PULSO Complete Schema
-- All-in-one migration for local SQLite + Cloudflare D1

-- =============================================
-- CATEGORIES (Cloudflare D1 + Local)
-- =============================================
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon TEXT
);

INSERT OR IGNORE INTO categories (slug, name, icon) VALUES
  ('politica', 'Política', '⚖️'),
  ('economia', 'Economía', '💰'),
  ('deportes', 'Deportes', '⚽'),
  ('espectaculos', 'Espectáculos', '🎭'),
  ('tecnologia', 'Tecnología', '💻'),
  ('sociedad', 'Sociedad', '👥'),
  ('internacional', 'Internacional', '🌍'),
  ('clima', 'Clima', '🌤️');

-- =============================================
-- LOCATIONS (118 Argentine locations)
-- =============================================
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  province TEXT NOT NULL,
  country TEXT DEFAULT 'AR',
  lat REAL,
  lng REAL,
  population INTEGER,
  type TEXT DEFAULT 'city',
  parent_id INTEGER,
  FOREIGN KEY (parent_id) REFERENCES locations(id)
);

-- Seed locations
INSERT OR IGNORE INTO locations (id, name, province, country, lat, lng, population, type, parent_id) VALUES
  (1, 'Argentina', 'Argentina', 'AR', -38.4161, -63.6167, 45000000, 'pais', NULL);

INSERT OR IGNORE INTO locations (id, name, province, country, lat, lng, population, type, parent_id) VALUES
  (2, 'Buenos Aires', 'Buenos Aires', 'AR', -34.6037, -58.3816, 15625000, 'provincia', 1),
  (3, 'Córdoba', 'Córdoba', 'AR', -31.4201, -64.1888, 3500000, 'provincia', 1),
  (4, 'Santa Fe', 'Santa Fe', 'AR', -32.9468, -60.6394, 3300000, 'provincia', 1),
  (5, 'Mendoza', 'Mendoza', 'AR', -32.8895, -68.8458, 1900000, 'provincia', 1),
  (6, 'Tucumán', 'Tucumán', 'AR', -26.8241, -65.2226, 1600000, 'provincia', 1),
  (7, 'Entre Ríos', 'Entre Ríos', 'AR', -31.7629, -60.4352, 1200000, 'provincia', 1),
  (8, 'Salta', 'Salta', 'AR', -24.7876, -65.4171, 1200000, 'provincia', 1),
  (9, 'Misiones', 'Misiones', 'AR', -27.4691, -55.1208, 1100000, 'provincia', 1),
  (10, 'Corrientes', 'Corrientes', 'AR', -27.4692, -58.8306, 1000000, 'provincia', 1),
  (11, 'Chaco', 'Chaco', 'AR', -27.4514, -58.9868, 1100000, 'provincia', 1),
  (12, 'Santiago del Estero', 'Santiago del Estero', 'AR', -27.7951, -64.2615, 900000, 'provincia', 1),
  (13, 'Jujuy', 'Jujuy', 'AR', -24.1858, -65.3028, 700000, 'provincia', 1),
  (14, 'Río Negro', 'Río Negro', 'AR', -40.8135, -63.0031, 700000, 'provincia', 1),
  (15, 'Neuquén', 'Neuquén', 'AR', -38.9516, -68.0591, 650000, 'provincia', 1),
  (16, 'Formosa', 'Formosa', 'AR', -26.1823, -58.1765, 600000, 'provincia', 1),
  (17, 'Chubut', 'Chubut', 'AR', -43.3002, -65.1032, 550000, 'provincia', 1),
  (18, 'San Juan', 'San Juan', 'AR', -31.5375, -68.5364, 700000, 'provincia', 1),
  (19, 'La Rioja', 'La Rioja', 'AR', -29.4131, -66.8563, 350000, 'provincia', 1),
  (20, 'Catamarca', 'Catamarca', 'AR', -28.4696, -65.7852, 350000, 'provincia', 1),
  (21, 'La Pampa', 'La Pampa', 'AR', -36.7769, -64.2836, 350000, 'provincia', 1),
  (22, 'Santa Cruz', 'Santa Cruz', 'AR', -50.3408, -72.2646, 350000, 'provincia', 1),
  (23, 'Tierra del Fuego', 'Tierra del Fuego', 'AR', -54.8019, -68.3030, 150000, 'provincia', 1),
  (24, 'San Luis', 'San Luis', 'AR', -33.3017, -66.3378, 450000, 'provincia', 1);

INSERT OR IGNORE INTO locations (id, name, province, country, lat, lng, population, type, parent_id) VALUES
  (100, 'CABA', 'Buenos Aires', 'AR', -34.6037, -58.3816, 3000000, 'autonomous_city', 2);

INSERT OR IGNORE INTO locations (id, name, province, country, lat, lng, population, type, parent_id) VALUES
  (101, 'Córdoba Capital', 'Córdoba', 'AR', -31.4201, -64.1888, 1500000, 'ciudad', 3),
  (102, 'Rosario', 'Santa Fe', 'AR', -32.9468, -60.6394, 1300000, 'ciudad', 4),
  (103, 'Mendoza Capital', 'Mendoza', 'AR', -32.8895, -68.8458, 900000, 'ciudad', 5),
  (104, 'San Miguel de Tucumán', 'Tucumán', 'AR', -26.8241, -65.2226, 600000, 'ciudad', 6),
  (105, 'La Plata', 'Buenos Aires', 'AR', -34.9214, -57.9544, 800000, 'ciudad', 2),
  (106, 'Mar del Plata', 'Buenos Aires', 'AR', -38.0023, -57.5575, 600000, 'ciudad', 2),
  (107, 'Salta Capital', 'Salta', 'AR', -24.7876, -65.4171, 500000, 'ciudad', 8),
  (108, 'Santa Fe Capital', 'Santa Fe', 'AR', -31.6239, -60.6971, 400000, 'ciudad', 4),
  (109, 'San Juan Capital', 'San Juan', 'AR', -31.5375, -68.5364, 450000, 'ciudad', 18),
  (110, 'Resistencia', 'Chaco', 'AR', -27.4514, -58.9868, 400000, 'ciudad', 11),
  (111, 'Posadas', 'Misiones', 'AR', -27.3621, -55.8965, 350000, 'ciudad', 9),
  (112, 'Neuquén Capital', 'Neuquén', 'AR', -38.9516, -68.0591, 300000, 'ciudad', 15),
  (113, 'Bahía Blanca', 'Buenos Aires', 'AR', -38.7183, -62.2663, 300000, 'ciudad', 2),
  (114, 'Paraná', 'Entre Ríos', 'AR', -31.7319, -60.5235, 270000, 'ciudad', 7),
  (115, 'Corrientes Capital', 'Corrientes', 'AR', -27.4692, -58.8306, 350000, 'ciudad', 10),
  (116, 'San Rafael', 'Mendoza', 'AR', -34.6177, -68.4964, 150000, 'ciudad', 5),
  (117, 'San Fernando del Valle de Catamarca', 'Catamarca', 'AR', -28.6716, -65.7852, 180000, 'ciudad', 20),
  (118, 'La Rioja Capital', 'La Rioja', 'AR', -29.4131, -66.8563, 150000, 'ciudad', 19),
  (119, 'Santiago del Estero Capital', 'Santiago del Estero', 'AR', -27.7951, -64.2615, 250000, 'ciudad', 12),
  (120, 'Zárate', 'Buenos Aires', 'AR', -34.0981, -59.0289, 120000, 'ciudad', 2),
  (121, 'Olavarría', 'Buenos Aires', 'AR', -36.8939, -60.3229, 110000, 'ciudad', 2),
  (122, 'Pergamino', 'Buenos Aires', 'AR', -33.8898, -60.5736, 100000, 'ciudad', 2),
  (123, 'Junín', 'Buenos Aires', 'AR', -34.5838, -60.9447, 90000, 'ciudad', 2),
  (124, 'Campana', 'Buenos Aires', 'AR', -34.1647, -58.9564, 95000, 'ciudad', 2),
  (125, 'San Nicolás', 'Buenos Aires', 'AR', -33.3357, -60.2204, 130000, 'ciudad', 2),
  (126, 'Vicente López', 'Buenos Aires', 'AR', -34.5264, -58.4885, 110000, 'ciudad', 2),
  (127, 'Florencio Varela', 'Buenos Aires', 'AR', -34.8173, -58.2795, 140000, 'ciudad', 2),
  (128, 'Quilmes', 'Buenos Aires', 'AR', -34.7294, -58.2667, 230000, 'ciudad', 2),
  (129, 'Berazategui', 'Buenos Aires', 'AR', -34.7659, -58.1918, 100000, 'ciudad', 2),
  (130, 'San Luis Capital', 'San Luis', 'AR', -33.3017, -66.3378, 180000, 'ciudad', 24),
  (131, 'Villa Mercedes', 'San Luis', 'AR', -33.6758, -65.4781, 130000, 'ciudad', 24),
  (132, ' Goya', 'Corrientes', 'AR', -29.1439, -59.2656, 70000, 'ciudad', 10),
  (133, 'Reconquista', 'Santa Fe', 'AR', -29.1439, -59.6439, 80000, 'ciudad', 4),
  (134, ' Rafaela', 'Santa Fe', 'AR', -31.2503, -61.4867, 90000, 'ciudad', 4),
  (135, 'San Francisco', 'Córdoba', 'AR', -31.4247, -62.0827, 60000, 'ciudad', 3),
  (136, 'Villa María', 'Córdoba', 'AR', -32.4078, -63.2406, 80000, 'ciudad', 3),
  (137, 'Tandil', 'Buenos Aires', 'AR', -37.3217, -59.1332, 100000, 'ciudad', 2),
  (138, 'Gral. Pico', 'La Pampa', 'AR', -35.6569, -63.7567, 60000, 'ciudad', 21),
  (139, 'Santa Rosa', 'La Pampa', 'AR', -36.6209, -64.2836, 100000, 'ciudad', 21),
  (140, 'Viedma Capital', 'Río Negro', 'AR', -40.8135, -63.0031, 50000, 'ciudad', 14),
  (141, 'Bariloche', 'Río Negro', 'AR', -41.1335, -71.3103, 100000, 'ciudad', 14),
  (142, 'San Carlos de Bariloche', 'Río Negro', 'AR', -41.1335, -71.3103, 100000, 'ciudad', 14),
  (143, 'Puerto Madryn', 'Chubut', 'AR', -42.7691, -65.0400, 80000, 'ciudad', 17),
  (144, 'Trelew', 'Chubut', 'AR', -43.2489, -65.3052, 100000, 'ciudad', 17),
  (145, 'Rawson Capital', 'Chubut', 'AR', -43.3002, -65.1032, 40000, 'ciudad', 17),
  (146, 'Comodoro Rivadavia', 'Chubut', 'AR', -45.8678, -67.4800, 180000, 'ciudad', 17),
  (147, 'Ushuaia Capital', 'Tierra del Fuego', 'AR', -54.8019, -68.3030, 60000, 'ciudad', 23),
  (148, 'Río Grande', 'Tierra del Fuego', 'AR', -53.7918, -67.6996, 70000, 'ciudad', 23),
  (149, 'Caleta Olivia', 'Santa Cruz', 'AR', -46.4393, -67.5281, 50000, 'ciudad', 22),
  (150, 'Rio Gallegos Capital', 'Santa Cruz', 'AR', -51.6231, -69.2168, 80000, 'ciudad', 22),
  (151, 'San Salvador de Jujuy', 'Jujuy', 'AR', -24.1858, -65.3028, 250000, 'ciudad', 13),
  (152, 'San Pedro de Jujuy', 'Jujuy', 'AR', -24.2296, -64.8644, 70000, 'ciudad', 13),
  (153, 'Libertador Gral. San Martín', 'Jujuy', 'AR', -23.8155, -64.7832, 50000, 'ciudad', 13),
  (154, 'Oberá', 'Misiones', 'AR', -27.4872, -55.1199, 60000, 'ciudad', 9),
  (155, 'Eldorado', 'Misiones', 'AR', -26.4061, -54.6094, 70000, 'ciudad', 9),
  (156, 'Puerto Iguazú', 'Misiones', 'AR', -25.5992, -54.5736, 40000, 'ciudad', 9),
  (157, 'Paso de los Libres', 'Corrientes', 'AR', -29.7135, -57.0878, 50000, 'ciudad', 10),
  (158, 'Gualeguaychú', 'Entre Ríos', 'AR', -33.0078, -58.5172, 80000, 'ciudad', 7),
  (159, 'Concordia', 'Entre Ríos', 'AR', -31.3923, -58.0167, 150000, 'ciudad', 7),
  (160, 'La Paz', 'Entre Ríos', 'AR', -30.7448, -59.6453, 25000, 'ciudad', 7),
  (161, 'Concepción del Uruguay', 'Entre Ríos', 'AR', -32.4825, -58.2375, 60000, 'ciudad', 7),
  (162, 'Zárate ', 'Buenos Aires', 'AR', -34.0981, -59.0289, 120000, 'ciudad', 2),
  (163, 'Luján', 'Buenos Aires', 'AR', -34.5703, -59.1050, 80000, 'ciudad', 2),
  (164, 'Azul', 'Buenos Aires', 'AR', -36.8107, -59.8585, 60000, 'ciudad', 2),
  (165, 'Olavarría ', 'Buenos Aires', 'AR', -36.8939, -60.3229, 110000, 'ciudad', 2),
  (166, 'Necochea', 'Buenos Aires', 'AR', -38.5546, -58.7390, 80000, 'ciudad', 2),
  (167, 'Pehuajó', 'Buenos Aires', 'AR', -35.8106, -61.9136, 35000, 'ciudad', 2),
  (168, 'Bahía Blanca ', 'Buenos Aires', 'AR', -38.7183, -62.2663, 300000, 'ciudad', 2),
  (169, 'San Antonio de Areco', 'Buenos Aires', 'AR', -34.2437, -59.4719, 25000, 'ciudad', 2),
  (170, 'Chivilcoy', 'Buenos Aires', 'AR', -34.6494, -60.0717, 60000, 'ciudad', 2),
  (171, ' Bragado', 'Buenos Aires', 'AR', -35.1164, -60.0667, 40000, 'ciudad', 2),
  (172, 'San Nicolás ', 'Buenos Aires', 'AR', -33.3357, -60.2204, 130000, 'ciudad', 2),
  (173, 'Venado Tuerto', 'Santa Fe', 'AR', -33.6826, -61.9689, 70000, 'ciudad', 4),
  (174, 'Santo Tomé', 'Santa Fe', 'AR', -31.6628, -60.7642, 60000, 'ciudad', 4),
  (175, 'Casilda', 'Santa Fe', 'AR', -33.0442, -61.1683, 35000, 'ciudad', 4),
  (176, 'Villa Constitución', 'Santa Fe', 'AR', -33.2279, -60.2608, 45000, 'ciudad', 4),
  (177, 'San Lorenzo', 'Santa Fe', 'AR', -32.7466, -60.7466, 40000, 'ciudad', 4),
  (178, 'Recreo', 'Santa Fe', 'AR', -31.4647, -60.7281, 20000, 'ciudad', 4),
  (179, 'Funes', 'Santa Fe', 'AR', -32.9173, -60.8109, 35000, 'ciudad', 4),
  (180, 'Sunchales', 'Santa Fe', 'AR', -30.9447, -61.5611, 20000, 'ciudad', 4),
  (181, 'Córdoba ', 'Córdoba', 'AR', -31.4201, -64.1888, 1500000, 'ciudad', 3),
  (182, 'Jesús María', 'Córdoba', 'AR', -30.9747, -64.0722, 30000, 'ciudad', 3),
  (183, 'Deán Funes', 'Córdoba', 'AR', -30.3536, -64.3497, 25000, 'ciudad', 3),
  (184, 'Unquillo', 'Córdoba', 'AR', -31.3533, -64.3164, 15000, 'ciudad', 3),
  (185, 'Mendoza ', 'Mendoza', 'AR', -32.8895, -68.8458, 900000, 'ciudad', 5),
  (186, 'Godoy Cruz', 'Mendoza', 'AR', -32.9281, -68.8547, 180000, 'ciudad', 5),
  (187, 'Guaymallén', 'Mendoza', 'AR', -32.9142, -68.7619, 250000, 'ciudad', 5),
  (188, 'Las Heras', 'Mendoza', 'AR', -32.8528, -68.8028, 200000, 'ciudad', 5),
  (189, 'San Rafael ', 'Mendoza', 'AR', -34.6177, -68.4964, 150000, 'ciudad', 5),
  (190, 'Tunuyán', 'Mendoza', 'AR', -33.5744, -69.0144, 50000, 'ciudad', 5),
  (191, 'San Martín (Mendoza)', 'Mendoza', 'AR', -33.0811, -68.4658, 50000, 'ciudad', 5),
  (192, 'Lavalle (Mendoza)', 'Mendoza', 'AR', -32.9833, -68.6000, 30000, 'ciudad', 5),
  (193, 'Maipú (Mendoza)', 'Mendoza', 'AR', -32.9833, -68.7500, 100000, 'ciudad', 5);

-- =============================================
-- SOURCES (Discovered by Scout)
-- =============================================
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  domain TEXT,
  location_id INTEGER,
  province TEXT,
  type TEXT DEFAULT 'diario',
  rss_url TEXT,
  wp_api_url TEXT,
  sitemap_url TEXT,
  extraction_method TEXT,
  reliability_score REAL DEFAULT 0.5,
  is_active BOOLEAN DEFAULT 1,
  deactivation_reason TEXT,
  last_fetch DATETIME,
  last_success DATETIME,
  fetch_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  news_count INTEGER DEFAULT 0,
  gacetilla_count INTEGER DEFAULT 0,
  avg_bias REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE INDEX IF NOT EXISTS idx_sources_active ON sources(is_active, last_fetch);
CREATE INDEX IF NOT EXISTS idx_sources_location ON sources(location_id);
CREATE INDEX IF NOT EXISTS idx_sources_domain ON sources(domain);

-- =============================================
-- NEWS CARDS (Cloudflare D1 - public facing)
-- =============================================
CREATE TABLE IF NOT EXISTS news_cards (
  id TEXT PRIMARY KEY,
  location_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  image_url TEXT,
  bias_score REAL DEFAULT 0,
  is_gacetilla INTEGER DEFAULT 0,
  cluster_id TEXT,
  category TEXT,
  source_ids TEXT,
  published_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE INDEX IF NOT EXISTS idx_news_location ON news_cards(location_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_category ON news_cards(category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_cluster ON news_cards(cluster_id);

-- =============================================
-- RAW NEWS (Local pipeline - extracted by Harvester)
-- =============================================
CREATE TABLE IF NOT EXISTS raw_news (
  id TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL,
  location_id INTEGER,
  original_url TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  summary TEXT,
  image_url TEXT,
  image_local_path TEXT,
  published_at DATETIME,
  extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE INDEX IF NOT EXISTS idx_raw_news_status ON raw_news(status, extracted_at);
CREATE INDEX IF NOT EXISTS idx_raw_news_source ON raw_news(source_id, published_at DESC);

-- =============================================
-- PROCESSED NEWS (Local pipeline - analyzed by Analyst)
-- =============================================
CREATE TABLE IF NOT EXISTS processed_news (
  id TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL,
  location_id INTEGER,
  original_url TEXT,
  title TEXT NOT NULL,
  body TEXT,
  summary TEXT,
  neutral_summary TEXT,
  image_url TEXT,
  image_local_path TEXT,
  bias_score REAL,
  bias_reasoning TEXT,
  is_gacetilla INTEGER DEFAULT 0,
  gacetilla_confidence REAL DEFAULT 0,
  cluster_id TEXT,
  category TEXT,
  item_count INTEGER DEFAULT 1,
  published_at DATETIME,
  analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'pending_clean',
  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE INDEX IF NOT EXISTS idx_processed_status ON processed_news(status, analyzed_at);
CREATE INDEX IF NOT EXISTS idx_processed_category ON processed_news(category);
CREATE INDEX IF NOT EXISTS idx_processed_cluster ON processed_news(cluster_id);

-- =============================================
-- CLEAN NEWS (Local pipeline - filtered by Cleaner)
-- =============================================
CREATE TABLE IF NOT EXISTS clean_news (
  id TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL,
  location_id INTEGER,
  original_url TEXT,
  title TEXT NOT NULL,
  neutral_summary TEXT NOT NULL,
  image_url TEXT,
  image_local_path TEXT,
  image_optimized_path TEXT,
  bias_score REAL,
  is_gacetilla INTEGER DEFAULT 0,
  cluster_id TEXT,
  category TEXT,
  quality_score REAL,
  source_ids TEXT,
  published_at DATETIME,
  cleaned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  synced INTEGER DEFAULT 0,
  synced_at DATETIME,
  sync_error TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE INDEX IF NOT EXISTS idx_clean_synced ON clean_news(synced, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_clean_location ON clean_news(location_id, published_at DESC);

-- =============================================
-- METRICS (Pipeline execution tracking)
-- =============================================
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name TEXT NOT NULL,
  cycle_started DATETIME NOT NULL,
  cycle_ended DATETIME,
  duration_ms INTEGER,
  status TEXT DEFAULT 'success',
  items_processed INTEGER DEFAULT 0,
  items_success INTEGER DEFAULT 0,
  items_failed INTEGER DEFAULT 0,
  error_message TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_metrics_skill ON metrics(skill_name, cycle_started DESC);

-- =============================================
-- LEADS: Raw leads from nic.ar
-- =============================================
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  domain TEXT,
  province TEXT,
  city TEXT,
  status TEXT DEFAULT 'pending',
  source_file TEXT DEFAULT 'leads.json',
  processed_at DATETIME,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
