import { createSignal, type JSX } from 'solid-js'
import MaterialIcon from './common/MaterialIcon'

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: JSX.Element;
  scrollContainer?: () => HTMLElement | null;
}

export default function PullToRefresh(props: PullToRefreshProps) {
  const [refreshing, setRefreshing] = createSignal(false);
  const [pullDistance, setPullDistance] = createSignal(0);
  let startY = 0;
  let pulling = false;

  const onTouchStart = (e: TouchEvent) => {
    const el = props.scrollContainer?.();
    if (el && el.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    pulling = true;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!pulling) return;
    const el = props.scrollContainer?.();
    if (el && el.scrollTop > 0) { pulling = false; return; }
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) {
      setPullDistance(Math.min(dy * 0.4, 80));
    }
  };

  const onTouchEnd = async () => {
    if (!pulling) return;
    pulling = false;
    const dist = pullDistance();
    setPullDistance(0);
    if (dist > 50) {
      setRefreshing(true);
      try { await props.onRefresh(); } catch {}
      finally { setRefreshing(false); }
    }
  };

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        class="flex justify-center items-center overflow-hidden transition-all duration-200"
        style={{ height: `${pullDistance()}px`, opacity: pullDistance() / 60 }}
      >
        {refreshing() ? (
          <MaterialIcon name="sync" size="lg" class="text-muted animate-spin" />
        ) : (
          <MaterialIcon name="arrow_downward" size="lg" class="text-muted" style={{ transform: `rotate(${pullDistance() * 3}deg)` }} />
        )}
      </div>
      {props.children}
    </div>
  );
}
