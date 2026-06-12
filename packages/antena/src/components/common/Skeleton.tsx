/** @jsxImportSource solid-js */
import { For, Show } from 'solid-js';

interface SkeletonProps {
  variant?: 'card' | 'cluster' | 'hero' | 'text' | 'avatar';
  class?: string;
  count?: number;
}

const SHIMMER_BG = 'linear-gradient(90deg, var(--bg-hover) 0%, var(--border-base) 50%, var(--bg-hover) 100%)';

function Shimmer(props: { class?: string; style?: Record<string, string> }) {
  return (
    <div
      role="presentation"
      class={`skeleton-shimmer rounded-[6px] ${props.class || ''}`}
      style={{ background: SHIMMER_BG, 'background-size': '200% 100%', ...(props.style || {}) }}
    />
  );
}

function CardSkeleton() {
  return (
    <div class="px-5 py-4 border-b border-border-base" aria-busy="true" role="status">
      <span class="sr-only">Cargando noticias...</span>
      <div class="flex items-center gap-2 mb-2.5">
        <Shimmer class="w-2 h-2 rounded-full" />
        <Shimmer class="w-16 h-3" />
        <Shimmer class="w-20 h-3" />
        <Shimmer class="w-10 h-3 ml-auto" />
      </div>
      <div class="flex gap-4">
        <div class="flex-1 min-w-0 flex flex-col gap-2">
          <Shimmer class="w-full h-4" />
          <Shimmer class="w-4/5 h-4" />
          <Shimmer class="w-full h-3 mt-1" />
          <Shimmer class="w-3/4 h-3" />
        </div>
        <Shimmer class="w-[130px] h-[85px] rounded-xl shrink-0" />
      </div>
      <div class="flex items-center gap-2 mt-3">
        <Shimmer class="w-20 h-5 rounded-md" />
        <div class="ml-auto flex items-center gap-1.5">
          <Shimmer class="w-8 h-7 rounded-full" />
          <Shimmer class="w-8 h-7 rounded-full" />
          <Shimmer class="w-8 h-7 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function ClusterSkeleton() {
  return (
    <div class="mx-5 my-3 p-4 rounded-2xl border border-border-base" aria-busy="true" role="status">
      <span class="sr-only">Cargando cluster...</span>
      <div class="flex items-center gap-2 mb-3">
        <Shimmer class="w-12 h-4 rounded-md" />
        <Shimmer class="w-20 h-3" />
        <Shimmer class="w-8 h-3 ml-auto" />
      </div>
      <div class="flex gap-3">
        <Shimmer class="w-20 h-20 rounded-xl shrink-0" />
        <div class="flex-1 min-w-0 flex flex-col gap-2">
          <Shimmer class="w-full h-4" />
          <Shimmer class="w-5/6 h-4" />
          <Shimmer class="w-full h-3 mt-1" />
          <Shimmer class="w-2/3 h-3" />
        </div>
      </div>
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div class="px-5 pt-4 pb-3" aria-busy="true" role="status">
      <span class="sr-only">Cargando destacado...</span>
      <Shimmer class="w-full h-[180px] rounded-2xl mb-3" />
      <div class="flex flex-col gap-2">
        <Shimmer class="w-20 h-4 rounded-md" />
        <Shimmer class="w-full h-5" />
        <Shimmer class="w-4/5 h-5" />
        <Shimmer class="w-full h-3 mt-1" />
        <Shimmer class="w-3/4 h-3" />
      </div>
    </div>
  );
}

function TextSkeleton() {
  return (
    <div aria-busy="true" role="status">
      <span class="sr-only">Cargando texto...</span>
      <Shimmer class="w-full h-3" />
    </div>
  );
}

function AvatarSkeleton() {
  return (
    <div aria-busy="true" role="status">
      <span class="sr-only">Cargando avatar...</span>
      <Shimmer class="w-10 h-10 rounded-full shrink-0" />
    </div>
  );
}

export default function Skeleton(props: SkeletonProps) {
  const variant = () => props.variant || 'card';
  const count = () => Math.max(1, props.count || 1);
  const single = () => count() === 1;

  const renderOne = () => {
    switch (variant()) {
      case 'cluster': return <ClusterSkeleton />;
      case 'hero': return <HeroSkeleton />;
      case 'text': return <TextSkeleton />;
      case 'avatar': return <AvatarSkeleton />;
      default: return <CardSkeleton />;
    }
  };

  return (
    <Show
      when={single()}
      fallback={
        <div class={props.class} role="status" aria-busy="true" aria-live="polite">
          <span class="sr-only">Cargando...</span>
          <For each={Array.from({ length: count() })}>
            {() => renderOne()}
          </For>
        </div>
      }
    >
      <div class={props.class}>
        {renderOne()}
      </div>
    </Show>
  );
}
