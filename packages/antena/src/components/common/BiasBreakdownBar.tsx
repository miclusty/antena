/** @jsxImportSource solid-js */
import type { VoiceBreakdown } from '../../lib/bias';

interface BiasBreakdownBarProps {
  voices: VoiceBreakdown[];
  showLabels?: boolean;
  barClass?: string;
  labelClass?: string;
}

export default function BiasBreakdownBar(props: BiasBreakdownBarProps) {
  if (!props.voices?.length) return null;

  return (
    <div>
      <div
        class={`w-full flex rounded-full overflow-hidden ${props.barClass || 'h-2'}`}
        style={{ background: 'var(--border-base)' }}
      >
        {props.voices.map((v) => (
          <div
            style={{ width: `${Math.max(v.pct, 2)}%`, 'background-color': v.color }}
            class="transition-all duration-300"
            title={`${v.label}: ${v.pct}%`}
          />
        ))}
      </div>
      {props.showLabels !== false && (
        <div class={`flex justify-between mt-1 ${props.labelClass || 'text-[10px]'}`}>
          {props.voices.map((v) => (
            <span class="font-semibold" style={{ color: v.color }}>
              {v.label} {v.pct}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
