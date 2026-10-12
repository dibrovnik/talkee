import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const SPEED_PX_PER_SEC = 32;
const LOOP_GAP_PX = 48;

/**
 * One line inside the notch or the pill.
 * A growing transcript keeps the latest words at the trailing edge.
 * A finished line scrolls from the start and repeats, the way a notch
 * now-playing title does, with the edges faded so letters are not cut off.
 */
export function TextTicker({ text, live }: { text: string; live: boolean }): ReactElement {
  const reduced = usePrefersReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  const [copyWidth, setCopyWidth] = useState(0);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const copy = copyRef.current;
    if (!host || !copy) {
      return;
    }
    const measure = (): void => {
      // The repeated copy includes a loop gap; never count it as text width.
      const width =
        copy.offsetWidth - Number.parseFloat(getComputedStyle(copy).paddingRight || "0");
      setCopyWidth(width);
      setOverflow(Math.max(0, width - host.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [text]);

  const looping = !live && overflow > 0 && !reduced;
  const following = live && overflow > 0;
  const duration = Math.max(4, (copyWidth + LOOP_GAP_PX) / SPEED_PX_PER_SEC);
  const mask = looping
    ? "linear-gradient(90deg, transparent, #000 14px, #000 calc(100% - 14px), transparent)"
    : following
      ? "linear-gradient(90deg, transparent, #000 18px, #000 100%)"
      : undefined;

  return (
    <div
      ref={hostRef}
      style={{
        overflow: "hidden",
        minWidth: 0,
        width: "100%",
        whiteSpace: "nowrap",
        textOverflow: reduced && !following ? "ellipsis" : "clip",
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    >
      <div
        className={looping ? "talkee-ticker-track" : undefined}
        style={{
          display: "inline-flex",
          transform: following ? `translateX(-${overflow}px)` : undefined,
          transition: following && !reduced ? "transform 240ms linear" : undefined,
          animation: looping ? `talkee-ticker ${duration}s linear infinite` : undefined,
        }}
      >
        <span ref={copyRef} style={copyStyle(looping)}>
          {text}
        </span>
        {looping && (
          <span aria-hidden="true" style={copyStyle(true)}>
            {text}
          </span>
        )}
      </div>
    </div>
  );
}

function copyStyle(gap: boolean): CSSProperties {
  return {
    paddingRight: gap ? LOOP_GAP_PX : 0,
    fontSize: 13,
    fontWeight: 500,
    lineHeight: "16px",
    letterSpacing: "-0.008em",
    color: "#fff",
    whiteSpace: "nowrap",
  };
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (): void => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
