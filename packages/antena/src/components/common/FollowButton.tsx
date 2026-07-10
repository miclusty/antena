/** @jsxImportSource solid-js */
import { Show, createSignal } from "solid-js";
import { useFollows } from "../../lib/follows";
import { useHaptic } from "../../lib/haptic";
import MaterialIcon from '../common/MaterialIcon';

/**
 * FollowButton — toggle a source's follow state.
 *
 * The button uses the same aria-label conventions as
 * NewsCard's bookmark button ("Seguir" / "Siguiendo") so screen
 * readers announce the current state. Visually: an outline
 * "Seguir" when not following, a filled "Siguiendo" with a
 * check when following. The label switches reactively when the
 * underlying `useFollows` state changes (so when the user
 * unfollows from elsewhere, this button updates too).
 */
interface FollowButtonProps {
  /** The source to follow. Required. */
  sourceId: number;
  /** Visual size: "sm" fits inside a card action bar,
   *  "md" is a stand-alone button. Default "sm". */
  size?: "sm" | "md";
  /** Optional callback for analytics (e.g. on follow). */
  onFollowed?: (sourceId: number) => void;
  /** Optional callback for analytics (e.g. on unfollow). */
  onUnfollowed?: (sourceId: number) => void;
}

export default function FollowButton(props: FollowButtonProps) {
  const haptic = useHaptic();
  const follows = useFollows();
  const [busy, setBusy] = createSignal(false);

  const isFollowing = () => follows.isFollowing(props.sourceId);

  const handleClick = async (e: MouseEvent) => {
    // Stop the click from bubbling up to parent elements (e.g.
    // the article card click that would navigate to the detail).
    e.stopPropagation();
    e.preventDefault();
    if (busy()) return;
    setBusy(true);
    try {
      const wasFollowing = isFollowing();
      const ok = await follows.toggle(props.sourceId);
      if (ok) {
        haptic.vibrate("tap");
        if (wasFollowing) {
          props.onUnfollowed?.(props.sourceId);
        } else {
          props.onFollowed?.(props.sourceId);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy()}
      class={
        "inline-flex items-center gap-1.5 rounded-full transition-all active:scale-95 disabled:opacity-50 " +
        (props.size === "md"
          ? "min-h-[44px] min-w-[44px] px-4 text-sm font-semibold"
          : "min-h-[44px] min-w-[44px] px-2.5 text-xs font-semibold")
      }
      style={{
        "background-color": isFollowing() ? "var(--accent)" : "transparent",
        color: isFollowing() ? "#fff" : "var(--accent)",
        border: isFollowing() ? "1px solid var(--accent)" : "1px solid var(--accent)",
      }}
      aria-label={isFollowing() ? "Siguiendo" : "Seguir"}
      aria-pressed={isFollowing()}
    >
      <MaterialIcon name={isFollowing() ? "check" : "add"} size="base" class="" style={{ "font-size": props.size === "md" ? "18px" : "14px", "font-variation-settings": isFollowing() ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20" : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20", }} aria-hidden="true" />
      <Show when={props.size === "md"}>
        <span>{isFollowing() ? "Siguiendo" : "Seguir"}</span>
      </Show>
    </button>
  );
}
