// The shared HTML shell every RealComply email renders into.
//
// Built 3 Sep 2026 after Adam saw the design preview: "so much better. Let's
// get that locked in." Until this, every email the app sent was plain text
// with no branding at all.
//
// ── WHY THIS LOOKS PLAINER THAN THE APP ───────────────────────────────────
//
// Email is a hostile rendering target and fighting it produces worse results
// than working inside it. Four constraints shape everything below, and none
// of them is a shortcut:
//
//   No web fonts. Outlook and most corporate clients block them outright, so
//   the brand face would silently fall back for a large share of readers.
//   A system stack renders identically for everyone instead.
//
//   Tables, not modern layout. Outlook on Windows renders through Word's
//   engine. Flexbox and grid do not work. Neither do most of the CSS
//   properties that would make this pleasant to write.
//
//   Inline styles. Gmail strips <style> blocks in some contexts, notably
//   forwarded mail. Anything that must survive is on the element.
//
//   No images. Blocked by default nearly everywhere until the reader clicks
//   "show images", which is why the wordmark is TYPE rather than a logo file:
//   type always renders. Revisit only if Adam decides a logo is worth the
//   share of readers who would see an empty box.
//
// ── DARK MODE ─────────────────────────────────────────────────────────────
//
// Apple Mail and Outlook invert colours on their own terms and no email
// design fully controls it. This is built to survive inversion rather than to
// fight it: solid backgrounds, real borders, and no light-grey-on-white that
// would vanish when flipped. Expect the green to shift slightly on some
// phones. That is accepted, not overlooked.

const BRAND = {
  ink: "#0d1f19",
  body: "#3a4a44",
  muted: "#5c6f68",
  faint: "#8a9a93",
  green: "#0ca678",
  greenDeep: "#0b8a5e",
  greenSoft: "#e9faf3",
  greenSoftLine: "#cdefe1",
  amber: "#b7791f",
  amberSoft: "#fdf6e7",
  amberSoftLine: "#f0e0bd",
  amberEdge: "#e2a94a",
  red: "#d03b3b",
  line: "#e4e9e6",
  rowBg: "#fafcfb",
  rowLine: "#eef2f0",
  white: "#ffffff",
} as const;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Tone drives the left edge of a row. Meaning first, decoration never. */
export type RowTone = "attention" | "risk" | "routine";

export type EmailRow = {
  title: string;
  /** Stage, agent, or a time-since line. */
  sub?: string;
  /** What actually needs doing. */
  detail?: string;
  tone?: RowTone;
};

export type EmailSection =
  | { kind: "label"; text: string }
  | { kind: "rows"; rows: EmailRow[] }
  | { kind: "note"; text: string }
  | { kind: "paragraph"; text: string; lead?: boolean }
  | { kind: "counter"; n: number; caption: string; tone: "good" | "warn" }
  | { kind: "button"; label: string; href: string };

export type EmailDocument = {
  /** The grey line beside the subject in an inbox list. Written, never inherited. */
  preheader: string;
  /** Small line under the title — agency and date on the digest. */
  meta?: string;
  title?: string;
  sections: EmailSection[];
  /** Footer lines. The diligence-support line belongs in every one of them. */
  footer: string[];
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const edge = (tone: RowTone = "routine"): string =>
  tone === "risk" ? BRAND.red : tone === "attention" ? BRAND.amberEdge : BRAND.greenSoftLine;

function renderSection(s: EmailSection): string {
  switch (s.kind) {
    case "paragraph":
      return `<tr><td style="padding:0 32px 16px;font-family:${FONT};font-size:${
        s.lead ? "16px" : "15px"
      };line-height:1.6;color:${s.lead ? BRAND.ink : BRAND.body};${
        s.lead ? "font-weight:600;" : ""
      }">${esc(s.text)}</td></tr>`;

    case "counter":
      return `<tr><td style="padding:18px 32px 4px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
          style="background:${s.tone === "warn" ? BRAND.amberSoft : BRAND.greenSoft};
                 border:1px solid ${s.tone === "warn" ? BRAND.amberSoftLine : BRAND.greenSoftLine};
                 border-radius:10px">
          <tr><td style="padding:18px 20px;font-family:${FONT}">
            <div style="font-size:30px;font-weight:800;line-height:1;color:${
              s.tone === "warn" ? BRAND.amber : BRAND.greenDeep
            }">${s.n}</div>
            <div style="font-size:13.5px;color:${BRAND.body};padding-top:5px">${esc(s.caption)}</div>
          </td></tr>
        </table></td></tr>`;

    case "label":
      return `<tr><td style="padding:26px 32px 10px;font-family:${FONT};font-size:11px;
        font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${BRAND.faint}">${esc(
        s.text,
      )}</td></tr>`;

    case "note":
      return `<tr><td style="padding:2px 32px 8px;font-family:${FONT};font-size:13.5px;
        line-height:1.55;color:${BRAND.faint}">${esc(s.text)}</td></tr>`;

    case "rows":
      return s.rows
        .map(
          (r) => `<tr><td style="padding:0 32px 8px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
          style="background:${BRAND.rowBg};border:1px solid ${BRAND.rowLine};
                 border-left:3px solid ${edge(r.tone)};border-radius:9px">
          <tr><td style="padding:13px 15px;font-family:${FONT}">
            <div style="font-size:14px;font-weight:700;color:${BRAND.ink}">${esc(r.title)}</div>
            ${
              r.sub
                ? `<div style="font-size:12.5px;color:${BRAND.faint};padding-top:2px">${esc(r.sub)}</div>`
                : ""
            }
            ${
              r.detail
                ? `<div style="font-size:13px;color:${BRAND.body};padding-top:6px">${esc(r.detail)}</div>`
                : ""
            }
          </td></tr>
        </table></td></tr>`,
        )
        .join("");

    case "button":
      // Table-wrapped rather than a padded <a>. Outlook ignores padding on an
      // anchor, which would collapse this into a bare blue link.
      return `<tr><td style="padding:24px 32px 4px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:${BRAND.green};border-radius:999px">
            <a href="${esc(s.href)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};
              font-size:14px;font-weight:700;color:${BRAND.white};text-decoration:none">${esc(
                s.label,
              )}</a>
          </td></tr></table></td></tr>`;

    default:
      return "";
  }
}

export function renderEmailHtml(doc: EmailDocument): string {
  const body = doc.sections.map(renderSection).join("");

  const footer = doc.footer
    .map(
      (line, i) =>
        `<div style="font-size:12px;line-height:1.55;color:${
          i === 0 ? BRAND.muted : BRAND.faint
        };padding-bottom:9px">${line}</div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(doc.title ?? "RealComply")}</title>
</head>
<body style="margin:0;padding:0;background:#eef1ef">

<!-- Preheader: shown beside the subject in an inbox list, hidden in the open
     message. The trailing whitespace stops the client filling the rest of the
     preview line with the first words of the body. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">
  ${esc(doc.preheader)}${"&#847;&zwnj;&nbsp;".repeat(60)}
</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
  style="background:#eef1ef">
  <tr><td align="center" style="padding:24px 12px">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
      style="width:600px;max-width:100%;background:${BRAND.white};border:1px solid ${BRAND.line};
             border-radius:10px">

      <tr><td style="padding:22px 32px;border-bottom:3px solid ${BRAND.green}">
        <span style="font-family:${FONT};font-size:17px;font-weight:800;letter-spacing:-0.3px;
          color:${BRAND.ink}">Real<span style="color:${BRAND.green}">Comply</span></span>
      </td></tr>

      ${
        doc.title
          ? `<tr><td style="padding:30px 32px 2px;font-family:${FONT};font-size:16px;
              font-weight:600;color:${BRAND.ink}">${esc(doc.title)}</td></tr>`
          : `<tr><td style="height:30px;line-height:30px">&nbsp;</td></tr>`
      }
      ${
        doc.meta
          ? `<tr><td style="padding:0 32px 4px;font-family:${FONT};font-size:12.5px;
              color:${BRAND.faint}">${esc(doc.meta)}</td></tr>`
          : ""
      }

      ${body}

      <tr><td style="padding:20px 32px 26px;border-top:1px solid ${BRAND.line};
        margin-top:14px;font-family:${FONT}">${footer}</td></tr>

    </table>

  </td></tr>
</table>
</body></html>`;
}

/**
 * The plain-text twin, built from the same document.
 *
 * Both versions ship on every send. Some people read in plain text by choice,
 * and a message with no text part is more likely to be scored as spam.
 *
 * Generated from the same structure rather than maintained separately, which
 * is the only way to be sure the two say the same thing a year from now.
 */
export function renderEmailText(doc: EmailDocument): string {
  const out: string[] = [];
  if (doc.title) out.push(doc.title);
  if (doc.meta) out.push(doc.meta);
  if (doc.title || doc.meta) out.push("");

  for (const s of doc.sections) {
    switch (s.kind) {
      case "paragraph":
        out.push(s.text, "");
        break;
      case "counter":
        out.push(`${s.n} ${s.caption}`, "");
        break;
      case "label":
        out.push(s.text.toUpperCase(), "-".repeat(s.text.length));
        break;
      case "note":
        out.push(`  ${s.text}`, "");
        break;
      case "rows":
        for (const r of s.rows) {
          const head = r.sub ? `${r.title} (${r.sub})` : r.title;
          out.push(r.detail ? `  - ${head}: ${r.detail}` : `  - ${head}`);
        }
        out.push("");
        break;
      case "button":
        out.push(`${s.label}: ${s.href}`, "");
        break;
    }
  }

  out.push("---");
  // Footer lines carry <a> tags for the HTML side; strip them for text.
  for (const line of doc.footer) {
    out.push(line.replace(/<[^>]+>/g, "").trim());
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const DILIGENCE_LINE =
  "RealComply provides diligence support to help you stay on top of compliance. " +
  "It doesn't guarantee compliance and doesn't replace your own judgement — you decide.";
