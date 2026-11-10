// The sections of an office's supervision guidelines, put together from the
// parts read (lib/sg-document/read.ts). A section is a top-level heading of
// the document ("4. Trust money") and the paragraphs under it, clause numbers
// and all ("4.1 ...", "4.2 ..."). Amendments (part 2) are made to one
// paragraph of one section, so the paragraphs are kept one by one.

export type ReadParagraph = {
  text: string;
  /** When this paragraph is the heading that starts a top-level section. */
  section: { number: string | null; title: string } | null;
};

/** One part's reading, as kept in sg_documents.read_parts. */
export type ReadPartResult = {
  paragraphs: ReadParagraph[];
  /** The first paragraph carries on a sentence from the page before (a PDF read in parts). */
  continues: boolean;
  /** The version number printed on the document, when this part showed it. */
  version: string | null;
};

export type SgSection = { position: number; number: string | null; title: string; paragraphs: string[] };

const MAX_TITLE = 300;
const MAX_NUMBER = 20;
const MAX_VERSION = 40;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** A part's reading as kept, or null when it isn't one (not read yet, or damaged). */
export function readPartOf(raw: unknown): ReadPartResult | null {
  const r = raw as Partial<ReadPartResult> | null | undefined;
  if (!r || typeof r !== "object" || !Array.isArray(r.paragraphs)) return null;
  const paragraphs: ReadParagraph[] = [];
  for (const p of r.paragraphs as unknown[]) {
    const q = p as Partial<ReadParagraph> | null;
    if (!q || typeof q !== "object" || typeof q.text !== "string") continue;
    const text = q.text.trim();
    const s = q.section as { number?: unknown; title?: unknown } | null | undefined;
    const title = s && typeof s.title === "string" ? oneLine(s.title) : "";
    const section = s && typeof s === "object" ? { number: typeof s.number === "string" && s.number.trim() ? oneLine(s.number) : null, title: title || oneLine(text) } : null;
    if (!text && !section) continue;
    paragraphs.push({ text, section: section && section.title ? section : null });
  }
  return {
    paragraphs,
    continues: r.continues === true,
    version: typeof r.version === "string" && r.version.trim() ? oneLine(r.version).slice(0, MAX_VERSION) : null,
  };
}

/**
 * The document's sections, in order, from its parts in page order. Anything
 * before the first heading is "Opening pages"; a document with no headings
 * found is one section, "The whole document". A heading's own line is the
 * section's title, not a paragraph of it.
 */
export function assembleSections(parts: ReadPartResult[]): SgSection[] {
  const flat: ReadParagraph[] = [];
  for (const part of parts) {
    part.paragraphs.forEach((p, i) => {
      const prev = flat[flat.length - 1];
      if (i === 0 && part.continues && prev && !prev.section && !p.section && p.text) {
        prev.text = `${prev.text} ${p.text}`.trim();
        return;
      }
      flat.push({ text: p.text, section: p.section });
    });
  }

  const anyHeading = flat.some((p) => p.section);
  const sections: Array<Omit<SgSection, "position">> = [];
  let current: Omit<SgSection, "position"> = {
    number: null,
    title: anyHeading ? "Opening pages" : "The whole document",
    paragraphs: [],
  };
  for (const p of flat) {
    if (p.section) {
      if (current.paragraphs.length > 0 || sections.length > 0 || current.title !== "Opening pages") sections.push(current);
      current = {
        number: p.section.number ? p.section.number.slice(0, MAX_NUMBER) : null,
        title: p.section.title.slice(0, MAX_TITLE),
        paragraphs: [],
      };
      continue;
    }
    const text = p.text.trim();
    if (text) current.paragraphs.push(text);
  }
  sections.push(current);
  return sections
    .filter((s, i) => !(i === 0 && s.title === "Opening pages" && s.paragraphs.length === 0))
    .map((s, position) => ({ ...s, position }));
}

/** The version printed on the document: the first part that showed one. */
export function versionOf(parts: ReadPartResult[]): string | null {
  return parts.find((p) => p.version)?.version ?? null;
}

/** Every word read, for the 2.1.3 checks. */
export function documentText(sections: SgSection[]): string {
  return sections.map((s) => [s.number, s.title, ...s.paragraphs].filter(Boolean).join("\n")).join("\n\n");
}

/** "4. Trust money", or the title alone when it has no number. */
export function sectionHeading(s: Pick<SgSection, "number" | "title">): string {
  if (!s.number) return s.title;
  return `${s.number.replace(/\.$/, "")}. ${s.title}`;
}
