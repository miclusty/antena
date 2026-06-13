/** Single source of truth for bias (sesgo politico) colors and labels.
 *  Colors follow Argentine political spectrum:
 *  - Light blue (#75AADB): Peronismo/Kirchnerismo (officialist under current government)
 *  - Dark blue (#1A3A6B): Hard Kirchnerismo
 *  - Gray (#968C83): Neutral / Center
 *  - Yellow (#F5C542): PRO / JxC (opposition)
 *  - Amber (#E8A37C): Mild opposition
 */

// VoiceBreakdown interface is defined in types.ts (single source).
// Re-exported here for backwards compat with imports from './bias'.
export type { VoiceBreakdown } from './types';

const BIAS_COLORS = {
  strong_officialist: '#1A3A6B',   // dark blue — Kirchnerismo duro
  mild_officialist: '#75AADB',     // light blue — Peronismo/K
  neutral: '#968C83',              // gray — Centro
  mild_opposition: '#E8A37C',      // amber — Oposicion moderada
  strong_opposition: '#F5C542',    // yellow — PRO / JxC
} as const;

export const VOICE_COLORS = {
  officialist: '#75AADB',          // light blue
  neutral: '#968C83',              // gray
  opposition: '#F5C542',           // yellow
} as const;

const BIAS_LABELS = {
  strong_officialist: 'Fuerte oficialista',
  mild_officialist: 'Oficialista',
  neutral: 'Neutral',
  mild_opposition: 'Opositor',
  strong_opposition: 'Fuerte opositor',
} as const;

export const VOICE_LABELS = {
  officialist: 'Oficialista',
  neutral: 'Neutral',
  opposition: 'Opositor',
} as const;

type BiasCategory = keyof typeof BIAS_LABELS;

interface BiasInfo {
  label: string;
  color: string;
  gradientColor: string;
  intensity: number;
  category: BiasCategory;
}

/** Map bias_score (-1.0 to +1.0) to 5-level categorical info. */
export function getBiasInfo(score: number | null | undefined): BiasInfo {
  if (score === null || score === undefined) {
    return { label: 'Sin datos', color: '#94a3b8', gradientColor: '#94a3b8', intensity: 0, category: 'neutral' };
  }
  if (score > 0.5) return { ...makeInfo('strong_officialist'), intensity: 5 };
  if (score > 0.1) return { ...makeInfo('mild_officialist'), intensity: 4 };
  if (score >= -0.1) return { ...makeInfo('neutral'), intensity: 3 };
  if (score >= -0.5) return { ...makeInfo('mild_opposition'), intensity: 2 };
  return { ...makeInfo('strong_opposition'), intensity: 1 };
}

function makeInfo(cat: BiasCategory): Omit<BiasInfo, 'intensity'> {
  return { label: BIAS_LABELS[cat], color: BIAS_COLORS[cat], gradientColor: BIAS_COLORS[cat], category: cat };
}

/**
 * Get a CONTINUOUS color for a raw bias_score.
 * Interpolates between light-blue (-1.0) → gray (0.0) → dark-blue (+1.0).
 * This preserves the precise intensity that categorical binning discards.
 */
export function getBiasGradientColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return '#94a3b8';
  const clamped = Math.max(-1, Math.min(1, score));
  if (clamped >= 0) {
    if (clamped <= 0.5) {
      // 0 (gray #968C83) → 0.5 (light blue #75AADB)
      const t = clamped / 0.5;
      const r = Math.round(150 + (117 - 150) * t);
      const g = Math.round(140 + (170 - 140) * t);
      const b = Math.round(131 + (219 - 131) * t);
      return `rgb(${r},${g},${b})`;
    } else {
      // 0.5 (light blue #75AADB) → 1.0 (dark blue #1A3A6B)
      const t = (clamped - 0.5) / 0.5;
      const r = Math.round(117 + (26 - 117) * t);
      const g = Math.round(170 + (58 - 170) * t);
      const b = Math.round(219 + (107 - 219) * t);
      return `rgb(${r},${g},${b})`;
    }
  } else {
    // -1 (yellow #F5C542) → 0 (gray). t goes from 0 (clamped=-1)
    // to 1 (clamped=0), so the start color is yellow and the end
    // color is gray. (Previously the formula was inverted: at
    // score=-1 it returned gray, contradicting the comment above.
    // The bias.test.ts TODO(Phase 8+) is now fixed by this change.)
    const t = 1 - Math.abs(clamped);
    const r = Math.round(245 + (150 - 245) * t);
    const g = Math.round(197 + (140 - 197) * t);
    const b = Math.round(66 + (131 - 66) * t);
    return `rgb(${r},${g},${b})`;
  }
}
