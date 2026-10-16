// "Did you know?": short notes on NSW obligations that sit outside a
// listing's file (Adam, 15 Oct 2026; mockup approved the same day).
//
// Content only. The page (src/app/dashboard/did-you-know/page.tsx) renders
// whatever is here, so another state is a content job: a new file beside this
// one, not a new page. Static, no database table.
//
// The wording is the brief's, word for word. Change it here and nowhere else.
//
// SOURCES, checked 15 Oct 2026:
//   - Property and Stock Agents Act 2002 (NSW), current version 29 June 2026
//     (s31(3), s32(3)(c), s43 to s45, s47, s48, s50)
//   - Property and Stock Agents Regulation 2022 (NSW), current version 1 July
//     2025 (Schedule 1, the rules of conduct, incl. cl 13; Schedule 2 cl 8)
//   - Unclaimed Money Act 1995 (NSW) (s9B, s10)
//   - NSW Fair Trading, "Licensee in charge" and "Supervision guidelines"
//     pages
//   - Revenue NSW, unclaimed money page (lodging and paying unclaimed money)
//
// Two of the agents' notes (4, agency name on all advertising, and 5,
// marketing must match the facts and the agreement) were cards on every
// listing's On market stage until 15 Oct 2026 (c2 and c3 in nsw-sales.ts).

/** A block of a note's body: a paragraph, a bulleted list, or a small line. */
export type DidYouKnowBlock =
  | { kind: "text"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "small"; text: string };

export type DidYouKnowNote = {
  title: string;
  /** The law reference, shown as a small pill beside the title. */
  law: string;
  body: DidYouKnowBlock[];
};

export type DidYouKnowSection = {
  id: "licensee" | "agents";
  heading: string;
  /** The small line under the heading, when there is one. */
  audience?: string;
  notes: DidYouKnowNote[];
};

export const DID_YOU_KNOW_FOOTER = "Diligence support. Not legal advice. The licensee in charge decides.";

export const NSW_DID_YOU_KNOW: DidYouKnowSection[] = [
  {
    id: "licensee",
    heading: "For the licensee in charge",
    audience: "Shown to everyone. Written for the licensee in charge.",
    notes: [
      {
        title: "Changing the licensee in charge",
        law: "s31(3)",
        body: [
          {
            kind: "text",
            text: "Tell Fair Trading within 5 business days of a new licensee in charge starting. Give their name, licence number and each office they cover. Keep a record of each licensee in charge and their dates.",
          },
        ],
      },
      {
        title: "Monitoring compliance",
        law: "s32(3)(c)",
        body: [
          {
            kind: "text",
            text: "You need a system to check the agency follows the rules, and a record of anything found and fixed. The law sets no general frequency, but trust accounts must be reviewed monthly.",
          },
          {
            kind: "text",
            text: "In RealComply: your Home page, file sign-offs, and the breaches and corrective actions register.",
          },
        ],
      },
      {
        title: "Unclaimed trust money",
        law: "Unclaimed Money Act 1995 s9B, s10",
        body: [
          {
            kind: "text",
            text: "Trust money held for more than 2 years is unclaimed. First try to find the owner. If you can’t, lodge it with Revenue NSW by 31 October for money held at 30 June. Pay within 7 days of lodging. Your trust software and auditor usually help with this.",
          },
        ],
      },
      {
        title: "Staff who can’t work in an agency",
        law: "s43 to s45",
        body: [
          {
            kind: "text",
            text: "Don’t employ or engage a disqualified person. Staff must tell you within 7 days if they become disqualified. You must tell Fair Trading in writing within 7 days of finding out.",
          },
        ],
      },
    ],
  },
  {
    id: "agents",
    heading: "For all agents",
    notes: [
      {
        title: "Referrals",
        law: "s47",
        body: [
          {
            kind: "text",
            text: "When you refer a client or buyer to a service provider (a broker, conveyancer, buyer’s agent), disclose any relationship and any benefit on Fair Trading’s form. They must sign it when you refer them, before any contract.",
          },
        ],
      },
      {
        title: "Acting for both buyer and seller",
        law: "s48",
        body: [
          {
            kind: "text",
            text: "You can’t act for the buyer and the seller in the same sale. Don’t sign agency agreements that could put you in that position.",
          },
        ],
      },
      {
        title: "Referral fees and the other side’s solicitor",
        law: "Reg Sch 2 cl 8, Sch 1 cl 13",
        body: [
          {
            kind: "text",
            text: "Don’t take a fee for referring a seller to a buyer’s agent. Don’t recommend a solicitor or conveyancer you know is acting for the other side, unless no one else is available. If so, tell the person.",
          },
        ],
      },
      {
        title: "Agency name on all advertising",
        law: "s50",
        body: [
          {
            kind: "text",
            text: "Every ad must show the agency’s licensed or registered business name. If you or the agency own the property, say so in the ad. Usually set once in your ad templates and portal profile.",
          },
        ],
      },
      {
        title: "Marketing must match the facts and the agreement",
        law: "Australian Consumer Law s18, s30",
        body: [
          {
            kind: "text",
            text: "No misleading or false claims about the property. Marketing should match what the vendor agreed and approved.",
          },
        ],
      },
      {
        title: "The conduct rules",
        law: "Reg Sch 1",
        body: [
          { kind: "text", text: "21 rules that apply to every agent on every job. For example:" },
          {
            kind: "list",
            items: [
              "Act honestly and fairly",
              "Act in your client’s best interests",
              "Don’t mislead anyone",
              "Keep client information confidential",
              "Don’t pressure people",
              "Follow your client’s lawful instructions",
            ],
          },
          { kind: "small", text: "Full list in plain English. Agents confirm them once in the SG Manual." },
        ],
      },
    ],
  },
];
