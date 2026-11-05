import { legalReferenceLinks } from "@/lib/legislation/links";

// A legal reference with each cited section linked to the law (Adam, 5 Nov
// 2026). Opens in a new tab, so the card stays where it was.

export function LegalReference({ text }: { text: string }) {
  return (
    <>
      {legalReferenceLinks(text).map((p, i) =>
        p.href ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            // The same look as "section 63" on the contract card (#117).
            className="font-medium text-rc-green-deep underline underline-offset-2 transition hover:text-rc-green-deep-600"
          >
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
