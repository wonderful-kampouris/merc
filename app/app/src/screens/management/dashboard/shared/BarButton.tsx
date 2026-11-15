import type { ReactNode } from "react";

/**
 * A full-width, unstyled clickable row (label + bar) used by the breakdown charts. ui-base has no
 * "clickable list row" primitive; this resets the native button so the bar keeps the card's typography.
 */
export function BarButton(props: { onClick: () => void; label: string; children: ReactNode; "data-bucket"?: string }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      data-bucket={props["data-bucket"]}
      onClick={props.onClick}
      style={{ all: "unset", display: "block", width: "100%", cursor: "pointer", boxSizing: "border-box" }}
    >
      {props.children}
    </button>
  );
}
