/** @jsxImportSource solid-js */
import { createSignal, For } from 'solid-js';
import MaterialIcon from '../common/MaterialIcon';

interface ImageGalleryProps {
  images: string[];
}

export default function ImageGallery(props: ImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [isLightbox, setIsLightbox] = createSignal(false);
  const images = () => props.images || [];

  return (
    <>
      <div
        class="relative w-full rounded-lg overflow-hidden border"
        style={{ 'border-color': 'var(--border-base)' }}
      >
        <div
          class="relative w-full cursor-zoom-in"
          style={{ 'padding-bottom': images().length > 1 ? '56.25%' : 'auto' }}
          onClick={() => setIsLightbox(true)}
        >
          <img
            src={images()[selectedIndex()]}
            alt=""
            class={images().length > 1 ? 'absolute inset-0 w-full h-full object-cover' : 'w-full rounded-lg'}
            loading="lazy"
          />
        </div>

        {images().length > 1 && (
          <div class="flex gap-1 p-2 overflow-x-auto scrollbar-hide" style={{ background: 'var(--bg-hover)' }}>
            <For each={images()}>
              {(img, idx) => (
                <button
                  onClick={() => setSelectedIndex(idx())}
                  class="w-16 h-10 rounded overflow-hidden shrink-0 border-2 transition-colors"
                  style={{
                    'border-color': selectedIndex() === idx() ? 'var(--accent)' : 'transparent',
                  }}
                >
                  <img src={img} alt="" class="w-full h-full object-cover" loading="lazy" />
                </button>
              )}
            </For>
          </div>
        )}

        {images().length > 1 && (
          <div class="absolute bottom-3 right-3 px-2 py-1 rounded-full bg-black/60 text-white text-[10px] font-medium">
            {selectedIndex() + 1} / {images().length}
          </div>
        )}
      </div>

      {isLightbox() && (
        <div
          class="fixed inset-0 bg-black/90 flex items-center justify-center p-4"
          style={{ 'z-index': 'var(--z-modal)' }}
          onClick={() => setIsLightbox(false)}
        >
          <button class="absolute top-4 right-4 text-white/80 hover:text-white transition-colors" onClick={() => setIsLightbox(false)}>
            <MaterialIcon name="close" size="base" class="text-[32px] " style={{ }} />
          </button>

          {images().length > 1 && (
            <button
              class="absolute left-4 text-white/80 hover:text-white transition-colors"
              onClick={(e) => { e.stopPropagation(); setSelectedIndex((selectedIndex() - 1 + images().length) % images().length); }}
            >
              <MaterialIcon name="chevron_left" size="base" class="text-[40px] " style={{ }} />
            </button>
          )}

          <img src={images()[selectedIndex()]} alt="" class="max-w-full max-h-[90vh] object-contain rounded-lg" />

          {images().length > 1 && (
            <button
              class="absolute right-4 text-white/80 hover:text-white transition-colors"
              onClick={(e) => { e.stopPropagation(); setSelectedIndex((selectedIndex() + 1) % images().length); }}
            >
              <MaterialIcon name="chevron_right" size="base" class="text-[40px] " style={{ }} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
