/** @jsxImportSource solid-js */
import { createSignal, createMemo, Show } from 'solid-js';
import MaterialIcon from '../common/MaterialIcon';

interface MediaEmbedProps {
  url: string;
  autoplay?: boolean;
}

export default function MediaEmbed(props: MediaEmbedProps) {
  const [isLoaded, setIsLoaded] = createSignal(false);

  const videoInfo = createMemo(() => {
    const url = props.url;
    const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      return {
        type: 'youtube' as const,
        id: ytMatch[1],
        embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}?rel=0&modestbranding=1${props.autoplay ? '&autoplay=1' : ''}`,
        thumbnail: `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`,
      };
    }
    const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vimeoMatch) {
      return {
        type: 'vimeo' as const,
        id: vimeoMatch[1],
        embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}?title=0&byline=0&portrait=0${props.autoplay ? '&autoplay=1' : ''}`,
        thumbnail: null,
      };
    }
    return null;
  });

  return (
    <div
      class="relative w-full rounded-lg overflow-hidden border"
      style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
    >
      {videoInfo() ? (
        <div class="relative w-full" style={{ 'padding-bottom': '56.25%' }}>
          <Show when={!isLoaded()}>
            <div
              class="absolute inset-0 flex items-center justify-center"
              style={{ background: 'var(--bg-hover)' }}
            >
              <div class="flex flex-col items-center gap-2">
                <div
                  class="w-16 h-16 rounded-full border flex items-center justify-center shadow-sm"
                  style={{
                    background: 'var(--bg-elevated)',
                    'border-color': 'var(--border-base)',
                  }}
                >
                  <MaterialIcon name="play_circle" size="3xl" class="text-[32px] " style={{ color: 'var(--text-tertiary)' }} />
                </div>
                <span class="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
                  {videoInfo()!.type === 'youtube' ? 'YouTube' : 'Vimeo'}
                </span>
              </div>
            </div>
          </Show>
          <iframe
            src={videoInfo()!.embedUrl}
            class="absolute inset-0 w-full h-full"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            onLoad={() => setIsLoaded(true)}
            loading="lazy"
          />
        </div>
      ) : (
        <video src={props.url} class="w-full rounded-lg" controls preload="metadata" />
      )}
    </div>
  );
}
