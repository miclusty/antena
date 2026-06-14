// ═══════════════════════════════════════════
// MaterialIcon — single source of truth for the
// material-symbols-rounded font + variation settings.
// Replace raw <span class="material-symbols-rounded …">
// blocks with <MaterialIcon name="…" /> to keep the
// variation settings consistent across the app.
// ═══════════════════════════════════════════

import { splitProps } from 'solid-js';
import type { JSX } from 'solid-js';

type Size = 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';

interface MaterialIconProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  name: string;
  // Default 'base' (16px line-height class). Drives both
  // the tailwind text-* class and the font opsz hint.
  size?: Size;
  // Default 300 (light). 400 = regular, 500 = medium,
  // 700 = bold. Material Symbols draws weight literally.
  weight?: 200 | 300 | 400 | 500 | 600 | 700;
  // Default false. When true, switches FILL to 1 (filled
  // glyph) which is the convention for active/selected
  // states (bookmark filled, vote arrow pushed, etc).
  filled?: boolean;
}

const SIZE_TO_OPSZ: Record<Size, number> = {
  xs: 14,
  sm: 16,
  base: 18,
  lg: 20,
  xl: 24,
  '2xl': 28,
  '3xl': 36,
  '4xl': 44,
  '5xl': 56,
};

export default function MaterialIcon(props: MaterialIconProps) {
  const [local, rest] = splitProps(props, ['name', 'size', 'weight', 'filled', 'class', 'style']);
  const size = () => local.size ?? 'base';
  const opsz = () => SIZE_TO_OPSZ[size()];
  const className = () => `material-symbols-rounded text-${size()} leading-none ${local.class ?? ''}`.trim();
  const style = (): JSX.CSSProperties => ({
    'font-variation-settings': `'FILL' ${local.filled ? 1 : 0}, 'wght' ${local.weight ?? 300}, 'GRAD' 0, 'opsz' ${opsz()}`,
    ...(local.style as JSX.CSSProperties),
  });
  return <span class={className()} style={style()} {...rest}>{local.name}</span>;
}
