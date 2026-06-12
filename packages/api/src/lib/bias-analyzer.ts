/**
 * Bias Analyzer v2 - Sistema de detección de sesgo con media ponderada
 * 
 * Principios:
 * - El sesgo se mide por el ENCUADRE (framing), no por el tema
 * - Sentimiento negativo ≠ sesgo político
 * - Mencionar una figura ≠ sesgo, el tono sí
 * - La fuente es la señal más fuerte (conocimiento previo del medio)
 * 
 * Score: 0 = izquierda, 0.5 = centro, 1 = derecha
 */

// ============================================
// 1. SOURCE BIAS REGISTRY (100+ medios argentinos)
// ============================================
interface SourceBias {
  score: number;      // 0 = izquierda, 0.5 = centro, 1 = derecha
  confidence: number; // 0-1 que tan seguro estamos
  type: string;
}

const SOURCE_BIAS_REGISTRY: Record<string, SourceBias> = {
  // ===== DERECHA / LIBERAL (0.7-0.9) =====
  'lanacion.com.ar': { score: 0.82, confidence: 0.95, type: 'derecha-liberal' },
  'clarin.com': { score: 0.72, confidence: 0.90, type: 'centro-derecha' },
  'ambito.com': { score: 0.68, confidence: 0.85, type: 'centro-derecha' },
  'infobae.com': { score: 0.65, confidence: 0.85, type: 'centro-derecha' },
  'perfil.com': { score: 0.65, confidence: 0.80, type: 'centro-derecha' },
  'cronista.com': { score: 0.62, confidence: 0.80, type: 'centro-derecha' },
  'buenosairesherald.com': { score: 0.75, confidence: 0.75, type: 'derecha' },
  'eleconomista.com.ar': { score: 0.68, confidence: 0.80, type: 'centro-derecha' },
  'iprofesional.com': { score: 0.70, confidence: 0.75, type: 'centro-derecha' },
  'apolitical.co': { score: 0.60, confidence: 0.60, type: 'centro-derecha' },
  'lavoz.com.ar': { score: 0.55, confidence: 0.70, type: 'centro' },
  'losandes.com.ar': { score: 0.55, confidence: 0.70, type: 'centro' },
  
  // ===== CENTRO / INDEPENDIENTE (0.45-0.55) =====
  'tn.com.ar': { score: 0.52, confidence: 0.75, type: 'centro' },
  'pagina12.com.ar': { score: 0.28, confidence: 0.90, type: 'centro-izquierda' },
  'eltrecetv.com.ar': { score: 0.50, confidence: 0.60, type: 'centro' },
  'telam.com.ar': { score: 0.48, confidence: 0.70, type: 'centro' },
  'diariouno.com.ar': { score: 0.50, confidence: 0.65, type: 'centro' },
  'diarioveloz.com': { score: 0.50, confidence: 0.55, type: 'centro' },
  'minutouno.com': { score: 0.55, confidence: 0.60, type: 'centro' },
  'parlamentario.com': { score: 0.50, confidence: 0.55, type: 'centro' },
  'diarioregistrado.com': { score: 0.48, confidence: 0.55, type: 'centro' },
  'agenciapacourondo.com': { score: 0.45, confidence: 0.60, type: 'centro-izquierda' },
  
  // ===== CENTRO-IZQUIERDA / PROGRESISTA (0.3-0.45) =====
  'tiempoar.com.ar': { score: 0.32, confidence: 0.80, type: 'centro-izquierda' },
  'tiempoargentina.com.ar': { score: 0.32, confidence: 0.80, type: 'centro-izquierda' },
  'pagina12.com': { score: 0.28, confidence: 0.90, type: 'centro-izquierda' },
  'c5n.com': { score: 0.30, confidence: 0.75, type: 'centro-izquierda' },
  'radiocut.fm': { score: 0.35, confidence: 0.65, type: 'centro-izquierda' },
  'elcoquetcv.com': { score: 0.40, confidence: 0.55, type: 'centro-izquierda' },
  'agenciadenoticias.com.ar': { score: 0.45, confidence: 0.55, type: 'centro' },
  
  // ===== IZQUIERDA (0.1-0.3) =====
  'telesurtv.net': { score: 0.20, confidence: 0.80, type: 'izquierda' },
  'resumenlatinoamericano.org': { score: 0.15, confidence: 0.85, type: 'izquierda' },
  'lavaca.org': { score: 0.20, confidence: 0.75, type: 'izquierda' },
  'contramarcha.com.ar': { score: 0.18, confidence: 0.70, type: 'izquierda' },
  
  // ===== MEDIOS REGIONALES CONOCIDOS =====
  'lagaceta.com.ar': { score: 0.60, confidence: 0.70, type: 'centro-derecha' },
  'eltucumano.com': { score: 0.55, confidence: 0.60, type: 'centro' },
  'infotuc.com.ar': { score: 0.55, confidence: 0.60, type: 'centro' },
  'eldia.com': { score: 0.55, confidence: 0.70, type: 'centro' },
  'eltribuno.com': { score: 0.58, confidence: 0.65, type: 'centro-derecha' },
  'diariodecuyo.com.ar': { score: 0.55, confidence: 0.60, type: 'centro' },
  'lanueva.com': { score: 0.60, confidence: 0.65, type: 'centro-derecha' },
  'conclusion.com.ar': { score: 0.55, confidence: 0.60, type: 'centro' },
  'puntobiz.com.ar': { score: 0.55, confidence: 0.55, type: 'centro' },
  'informatesalta.com.ar': { score: 0.55, confidence: 0.55, type: 'centro' },
  'feedbacksalta.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'cuarto.com.ar': { score: 0.55, confidence: 0.55, type: 'centro' },
  'primeraedicion.com.ar': { score: 0.55, confidence: 0.55, type: 'centro' },
  'todosalta.com': { score: 0.50, confidence: 0.50, type: 'centro' },
  '24sietenoticias.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  '360digitalnoticias.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  '381noticias.com.ar': { score: 0.55, confidence: 0.55, type: 'centro' },
  '370noticias.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'a1noticias-litoral.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'abc1noticias.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'abcrevista.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'adndiario.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'agenciacentraldenoticias.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'agenciadenoticiasjudiciales.com': { score: 0.50, confidence: 0.55, type: 'centro' },
  'agenciadenoticiasbonaerenses.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'agencianoticiaslarioja.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'agendadenoticias.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'agoranoticias.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'aguadeoronoticias.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'mendozaopina.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'santafe3.com': { score: 0.50, confidence: 0.55, type: 'centro' },
  'eldiariodemardelplata.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
  'radioalcorta.com': { score: 0.50, confidence: 0.50, type: 'centro' },
  'baeletrica.com': { score: 0.50, confidence: 0.50, type: 'centro' },
  'agenciamol.com.ar': { score: 0.50, confidence: 0.50, type: 'centro' },
};

// ============================================
// 2. FRAMING INDICATORS (no temas, sino ENCUADRES)
// ============================================

// Palabras que indican ENCUADRE favorable a la derecha/liberalismo
const RIGHT_FRAMING = [
  // Framing económico liberal
  'gasto parasitario', 'motosierra', 'déficit cero', 'ajuste necesario',
  'libertad económica', 'libre mercado', 'desregulación', 'privatización',
  'eficiencia del mercado', 'estado gendarme', 'responsabilidad fiscal',
  'inflación heredada', 'herencia maldita', 'casta política',
  'vagos de mierda', 'chorros de mierda', 'planeros',
  
  // Framing de seguridad (derecha)
  'mano dura', 'protocolo antipiquete', 'represión justificada',
  'delincuencia rampante', 'inseguridad galopante', 'tolerancia cero',
  'baja de la edad de imputabilidad',
  
  // Framing cultural conservador
  'ideología de género', 'adoctrinamiento', 'kirchnerismo corrupto',
  'zurdos', 'progresismo K', 'populismo', 'estatización',
  
  // Adjetivos positivos para figuras de derecha
  'valiente', 'firme', 'decidido', 'coraje', 'convicción',
  'cambio necesario', 'nueva era', 'esperanza', 'libertad',
];

// Palabras que indican ENCUADRE favorable a la izquierda/progresismo
const LEFT_FRAMING = [
  // Framing económico popular
  'ajuste brutal', 'recorte salvaje', 'despidos masivos',
  'hambre', 'pobreza extrema', 'desigualdad', 'exclusión social',
  'entrega del patrimonio', 'privatización encubierta', 'endeudamiento',
  'FMI', 'fondos buitre', 'especulación financiera',
  
  // Framing de derechos sociales
  'derechos humanos', 'democracia', 'pueblo', 'trabajadores',
  'movimiento obrero', 'sindicatos', 'resistencia popular',
  'lucha social', 'movimientos sociales', 'piqueteros',
  'jubilados', 'vulnerables', 'sectores populares',
  
  // Framing contra figuras de derecha
  'dictadura', 'represión', 'violencia institucional',
  'autoritarismo', 'fascismo', 'neoliberalismo',
  'genocida', 'golpista', 'corporaciones',
  
  // Adjetivos positivos para figuras de izquierda
  'compañero', 'conducción', 'liderazgo popular',
  'justicia social', 'soberanía', 'patria',
];

// Palabras neutras de noticias (NO indican sesgo)
const NEUTRAL_WORDS = [
  'informó', 'anunció', 'confirmó', 'según', 'datos', 'estadísticas',
  'porcentaje', 'millones', 'miles', 'aumentó', 'disminuyó',
  'reunión', 'encuentro', 'declaraciones', 'entrevista',
  'jueves', 'viernes', 'sábado', 'domingo', 'lunes', 'martes', 'miércoles',
  'mañana', 'tarde', 'noche', 'hoy', 'ayer',
];

// ============================================
// 3. ENTIDADES POLÍTICAS (con contexto)
// ============================================

// Entidades con su posición en el espectro político
const POLITICAL_ENTITIES: Record<string, { score: number; mentions: string[]; role: string }> = {
  // Derecha / Liberal
  'milei': { score: 0.85, mentions: ['Javier Milei', 'Milei', 'presidente Milei'], role: 'presidente' },
  'villarruel': { score: 0.80, mentions: ['Victoria Villarruel', 'Villarruel'], role: 'vicepresidenta' },
  'caputo': { score: 0.75, mentions: ['Luis Caputo', 'Caputo'], role: 'ministro' },
  'petri': { score: 0.75, mentions: ['Luis Petri', 'Petri'], role: 'ministro' },
  'guillermo francos': { score: 0.70, mentions: ['Guillermo Francos', 'Francos'], role: 'jefe de gabinete' },
  'nicolas posse': { score: 0.75, mentions: ['Nicolás Posse', 'Posse'], role: 'jefe de gabinete' },
  'santiago caputo': { score: 0.80, mentions: ['Santiago Caputo'], role: 'asesor' },
  'carolina pipping': { score: 0.75, mentions: ['Carolina Pipping', 'Pipping'], role: 'funcionaria' },
  
  // Centro / Peronismo moderado
  'massa': { score: 0.40, mentions: ['Sergio Massa', 'Massa'], role: 'opositor' },
  'kicillof': { score: 0.35, mentions: ['Axel Kicillof', 'Kicillof'], role: 'gobernador' },
  'schiaretti': { score: 0.45, mentions: ['Juan Schiaretti', 'Schiaretti'], role: 'gobernador' },
  'grabois': { score: 0.25, mentions: ['Juan Grabois', 'Grabois'], role: 'líder social' },
  'maximiliano pullaro': { score: 0.45, mentions: ['Maximiliano Pullaro', 'Pullaro'], role: 'gobernador' },
  'gerardo morales': { score: 0.50, mentions: ['Gerardo Morales', 'Morales'], role: 'gobernador' },
  'horacio rodríguez larreta': { score: 0.55, mentions: ['Horacio Rodríguez Larreta', 'Larreta'], role: 'opositor' },
  'patricia bullrich': { score: 0.65, mentions: ['Patricia Bullrich', 'Bullrich'], role: 'opositora' },
  
  // Izquierda
  'cristina fernández': { score: 0.25, mentions: ['Cristina Fernández', 'CFK', 'Cristina Kirchner', 'vicepresidenta'], role: 'vicepresidenta' },
  'kirchner': { score: 0.30, mentions: ['Néstor Kirchner', 'Kirchner'], role: 'expresidente' },
  'alberto fernández': { score: 0.35, mentions: ['Alberto Fernández', 'Alberto'], role: 'expresidente' },
  'myriam bregman': { score: 0.15, mentions: ['Myriam Bregman', 'Bregman'], role: 'diputada' },
  'nicolas del caño': { score: 0.15, mentions: ['Nicolás del Caño', 'Del Caño'], role: 'diputado' },
  'jorge altamira': { score: 0.10, mentions: ['Jorge Altamira', 'Altamira'], role: 'líder' },
};

// ============================================
// 4. FUNCIONES DE ANÁLISIS
// ============================================

/**
 * Extrae el dominio de una URL
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Analiza el sesgo basado en la fuente
 */
export function analyzeSourceBias(sourceUrl: string): { score: number; confidence: number; type: string } {
  const domain = extractDomain(sourceUrl);
  
  // Buscar en el registry
  for (const [registryDomain, bias] of Object.entries(SOURCE_BIAS_REGISTRY)) {
    if (domain === registryDomain || domain.includes(registryDomain) || registryDomain.includes(domain)) {
      return { score: bias.score, confidence: bias.confidence, type: bias.type };
    }
  }
  
  // Si no encontramos, default neutral con baja confianza
  return { score: 0.5, confidence: 0.1, type: 'desconocido' };
}

/**
 * Analiza el encuadre (framing) del texto
 * Devuelve score: 0 = framing izquierda, 0.5 = neutral, 1 = framing derecha
 */
export function analyzeFraming(text: string): {
  score: number;
  rightIndicators: string[];
  leftIndicators: string[];
  totalIndicators: number;
} {
  const lowerText = text.toLowerCase();
  
  const rightMatches = RIGHT_FRAMING.filter(phrase => lowerText.includes(phrase.toLowerCase()));
  const leftMatches = LEFT_FRAMING.filter(phrase => lowerText.includes(phrase.toLowerCase()));
  
  const rightCount = rightMatches.length;
  const leftCount = leftMatches.length;
  const total = rightCount + leftCount;
  
  // Score: 0 = pura izquierda, 0.5 = neutral, 1 = pura derecha
  let score = 0.5;
  if (total > 0) {
    score = rightCount / total;
  }
  
  return {
    score,
    rightIndicators: rightMatches,
    leftIndicators: leftMatches,
    totalIndicators: total
  };
}

/**
 * Analiza entidades políticas mencionadas y el tono
 * IMPORTANTE: No es sesgo mencionar a una figura, es el tono
 */
export function analyzeEntities(text: string): {
  entities: Array<{ name: string; score: number; role: string }>;
  avgScore: number | null;
} {
  const lowerText = text.toLowerCase();
  const found: Array<{ name: string; score: number; role: string }> = [];
  
  for (const [key, entity] of Object.entries(POLITICAL_ENTITIES)) {
    for (const mention of entity.mentions) {
      if (lowerText.includes(mention.toLowerCase())) {
        found.push({ name: mention, score: entity.score, role: entity.role });
        break;
      }
    }
  }
  
  if (found.length === 0) {
    return { entities: [], avgScore: null };
  }
  
  const avgScore = found.reduce((sum, e) => sum + e.score, 0) / found.length;
  
  return { entities: found, avgScore };
}

/**
 * Analiza si el texto es noticioso vs. opinión/editorial
 */
export function isOpinionPiece(text: string): { isOpinion: boolean; confidence: number } {
  const lowerText = text.toLowerCase();
  
  const opinionIndicators = [
    'en mi opinión', 'a mi entender', 'considero', 'creo que',
    'es indignante', 'es vergonzoso', 'no podemos permitir',
    'deberían', 'tienen que', 'es hora de', 'basta de',
    'editorial', 'opinión', 'columna', 'análisis',
    'mi punto de vista', 'desde nuestra perspectiva',
  ];
  
  const newsIndicators = [
    'informó', 'según', 'datos', 'confirmó', 'anunció',
    'el día de hoy', 'esta mañana', 'fuentes oficiales',
  ];
  
  let opinionCount = 0;
  let newsCount = 0;
  
  opinionIndicators.forEach(w => { if (lowerText.includes(w)) opinionCount++; });
  newsIndicators.forEach(w => { if (lowerText.includes(w)) newsCount++; });
  
  const isOpinion = opinionCount > newsCount && opinionCount >= 2;
  const confidence = Math.min(1, (opinionCount + newsCount) / 5);
  
  return { isOpinion, confidence };
}

// ============================================
// 5. RESULTADO PRINCIPAL
// ============================================

export interface BiasResult {
  // Score final (0 = izquierda, 0.5 = centro, 1 = derecha)
  bias_score: number;
  bias_type: string;
  
  // Scores individuales
  source_score: number;
  framing_score: number;
  entity_score: number | null;
  
  // Indicadores
  right_indicators: string[];
  left_indicators: string[];
  political_entities: string[];
  is_opinion: boolean;
  
  // Metadatos
  confidence: number;
  signals_used: string[];
}

/**
 * Calcula el bias_score final con media ponderada
 * 
 * Pesos:
 * - Source: 50% (conocimiento previo del medio - señal más fuerte)
 * - Framing: 35% (encuadre del texto)
 * - Entity: 15% (figuras políticas mencionadas)
 * 
 * NOTA: Eliminamos sentiment porque sentimiento ≠ sesgo político
 */
export function analyzeBias(
  text: string,
  sourceUrl: string,
  title: string = ''
): BiasResult {
  const fullText = `${title} ${text}`.trim();
  const signalsUsed: string[] = [];
  
  // 1. Source-based bias (50%)
  const sourceAnalysis = analyzeSourceBias(sourceUrl);
  const hasSourceSignal = sourceAnalysis.confidence > 0.2;
  if (hasSourceSignal) signalsUsed.push('source');
  
  // 2. Framing analysis (35%)
  const framingAnalysis = analyzeFraming(fullText);
  const hasFramingSignal = framingAnalysis.totalIndicators > 0;
  if (hasFramingSignal) signalsUsed.push('framing');
  
  // 3. Entity analysis (15%)
  const entityAnalysis = analyzeEntities(fullText);
  const hasEntitySignal = entityAnalysis.avgScore !== null;
  if (hasEntitySignal) signalsUsed.push('entities');
  
  // 4. Opinion detection (metadato, no afecta score)
  const opinionAnalysis = isOpinionPiece(fullText);
  
  // ============================================
  // MEDIA PONDERADA
  // ============================================
  const WEIGHTS = {
    source: 0.50,   // 50% - Fuente (señal más confiable)
    framing: 0.35,  // 35% - Encuadre del texto
    entity: 0.15,   // 15% - Entidades mencionadas
  };
  
  let weightedSum = 0;
  let totalWeight = 0;
  
  // Source
  if (hasSourceSignal) {
    weightedSum += sourceAnalysis.score * WEIGHTS.source;
    totalWeight += WEIGHTS.source;
  }
  
  // Framing
  if (hasFramingSignal) {
    weightedSum += framingAnalysis.score * WEIGHTS.framing;
    totalWeight += WEIGHTS.framing;
  }
  
  // Entity
  if (hasEntitySignal) {
    weightedSum += entityAnalysis.avgScore! * WEIGHTS.entity;
    totalWeight += WEIGHTS.entity;
  }
  
  // Score final normalizado
  const biasScore = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  
  // Determinar tipo de sesgo
  let biasType: string;
  if (biasScore < 0.25) biasType = 'izquierda';
  else if (biasScore < 0.42) biasType = 'centro-izquierda';
  else if (biasScore < 0.58) biasType = 'centro';
  else if (biasScore < 0.75) biasType = 'centro-derecha';
  else biasType = 'derecha';
  
  // Calcular confianza
  // Más señales = más confianza
  // Source es la más confiable
  const signalCount = signalsUsed.length;
  const sourceConfidence = hasSourceSignal ? sourceAnalysis.confidence * 0.5 : 0;
  const framingConfidence = hasFramingSignal ? Math.min(0.3, framingAnalysis.totalIndicators * 0.1) : 0;
  const entityConfidence = hasEntitySignal ? Math.min(0.2, entityAnalysis.entities.length * 0.05) : 0;
  
  const confidence = Math.min(1, sourceConfidence + framingConfidence + entityConfidence + (signalCount > 1 ? 0.1 : 0));
  
  return {
    bias_score: Math.round(biasScore * 100) / 100,
    bias_type: biasType,
    
    source_score: sourceAnalysis.score,
    framing_score: framingAnalysis.score,
    entity_score: entityAnalysis.avgScore,
    
    right_indicators: framingAnalysis.rightIndicators,
    left_indicators: framingAnalysis.leftIndicators,
    political_entities: entityAnalysis.entities.map(e => e.name),
    is_opinion: opinionAnalysis.isOpinion,
    
    confidence: Math.round(confidence * 100) / 100,
    signals_used: signalsUsed
  };
}

// ============================================
// 6. LLM ANALYSIS (LM Studio)
// ============================================

export async function analyzeBiasWithLLM(
  text: string,
  title: string
): Promise<{
  bias_score: number;
  bias_type: string;
  reasoning: string;
} | null> {
  const prompt = `Analiza el sesgo político de este texto de noticias argentino.

El sesgo se mide por el ENCUADRE (framing), no por el tema.
- 0.0 = sesgo de izquierda/progresista
- 0.5 = neutral/centro  
- 1.0 = sesgo de derecha/liberal

Indicadores de sesgo de derecha: lenguaje pro-mercado, anti-estado, "casta", "gasto parasitario", "motosierra"
Indicadores de sesgo de izquierda: "pueblo", "trabajadores", "ajuste brutal", "derechos humanos", "resistencia"
Neutral: lenguaje informativo sin adjetivos valorativos

Texto: "${title}. ${text}"

Responde SOLO con JSON:
{"bias_score": 0.5, "bias_type": "centro", "reasoning": "explicacion breve"}`;

  try {
    const response = await fetch('http://localhost:1234/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.5-0.8b-mlx',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 150
      })
    });

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Análisis completo: heurística + LLM
 */
export async function analyzeBiasComplete(
  text: string,
  sourceUrl: string,
  title: string
): Promise<BiasResult & { llm_analysis: any }> {
  const heuristicResult = analyzeBias(text, sourceUrl, title);
  const llmResult = await analyzeBiasWithLLM(text, title);
  
  let finalScore = heuristicResult.bias_score;
  
  if (llmResult) {
    // Media: 60% heurística, 40% LLM
    finalScore = (heuristicResult.bias_score * 0.6) + (llmResult.bias_score * 0.4);
  }
  
  return {
    ...heuristicResult,
    bias_score: Math.round(finalScore * 100) / 100,
    llm_analysis: llmResult
  };
}
