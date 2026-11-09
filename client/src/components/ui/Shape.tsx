import { SHAPE_PATHS, type AnswerShape } from "../../lib/answers";

// The shape channel of an answer (DESIGN.md §5). Decorative on its own — the
// letter and label carry the meaning for assistive tech — so it's aria-hidden.
export function Shape({
  shape,
  size = 24,
  className,
  style,
}: {
  shape: AnswerShape;
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={SHAPE_PATHS[shape]} />
    </svg>
  );
}
