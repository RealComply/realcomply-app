// The RealComply roof, turned to point the way: the mark on a link that goes
// somewhere. Adam, 26 Oct 2026: the text arrows (← and →) were "very much a
// generic AI look and we want a more bespoke feel"; he chose this from three
// options (mockup https://claude.ai/artifact/Bt33xvwXsRXTjtVjk4koAj, B).
//
// Drawn from the roof in the logo (Logo.tsx): thick, with the eaves cut flat.
// Sized in em, so it matches whatever text it sits beside. Decoration only:
// the link's words say where it goes.

const FORWARD = "M0 0 L7 6 L0 12 L0 9.4 L4 6 L0 2.6 Z";
const BACK = "M8 0 L1 6 L8 12 L8 9.4 L4 6 L8 2.6 Z";

const TONES = {
  /** The brand green, on white. */
  brand: "text-rc-green-deep",
  /** The lighter green, on the dark menu. */
  onDark: "text-rc-green",
  /** The words' own colour: on a filled button, or a coloured link. */
  inherit: "",
} as const;

export function RoofMark({
  back = false,
  tone = "brand",
  spaced = true,
  className = "",
}: {
  /** Points back, before the words ("Home", "Registers"). */
  back?: boolean;
  tone?: keyof typeof TONES;
  /** A little space between the mark and the words; off when it stands alone. */
  spaced?: boolean;
  className?: string;
}) {
  const space = spaced ? (back ? "mr-[0.45em]" : "ml-[0.45em]") : "";
  return (
    <svg
      viewBox="0 0 8 12"
      aria-hidden="true"
      focusable="false"
      className={`inline-block h-[0.72em] w-[0.48em] shrink-0 align-[-0.04em] ${TONES[tone]} ${space} ${className}`}
    >
      <path d={back ? BACK : FORWARD} fill="currentColor" />
    </svg>
  );
}
