"use client";

// The export's print button (check, 10 Oct 2026). It was a <button> with no
// handler in a server component, so pressing it did nothing and the label
// told the licensee to go and find Print in the browser menu instead. This
// opens the browser's print dialog, where Save as PDF is one of the choices.
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600"
    >
      Print or save as PDF
    </button>
  );
}
