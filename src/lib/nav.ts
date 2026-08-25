import {
  BookOpen,
  Building2,
  FileText,
  ClipboardCheck,
  GraduationCap,
  Home,
  Landmark,
  LayoutGrid,
  PenLine,
  Users,
} from "lucide-react";

// The application's navigation, defined once.
//
// It used to live inside Sidebar.tsx, which was fine while the sidebar was the
// only thing that needed to know the app's destinations. Global search needs
// the same list — typing "gifts" should offer the Gift register the same way
// typing an address offers a listing — and two copies of a nav list drift the
// first time a page is added to one of them.
//
// `keywords` exist only for search. They are the words someone would actually
// type when they cannot remember what we called the page: "insurance" for
// Registers, "supervision" for the SG Manual. The label is not always the word
// in an agent's head.

export type NavLink = {
  href: string;
  label: string;
  Icon: typeof Home;
  /** Exact path match. Every route starts with "/dashboard", so without this
   *  the default prefix match lights Listings up on every page in the app. */
  exact?: boolean;
  /** Kept in an assistant's reduced navigation. Everything without it is
   *  office-wide — the whole portfolio, the agency's registers, the sign-off
   *  queue, the SG manual, the staff roster — and an assistant is attached to
   *  particular agents, not to the office (Adam, 20 Aug 2026). */
  assistantSees?: boolean;
  /** Which nav count, if any, shows as a badge on this row. */
  countKey?: NavCountKey;
  /** Extra search terms. Never rendered. */
  keywords?: string[];
};

export type NavCountKey = "listings" | "signoffs" | "registers" | "trust";

export type NavGroup = { heading: string; links: NavLink[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Your work",
    links: [
      { href: "/dashboard/home", label: "Home", Icon: Home, assistantSees: true, keywords: ["dashboard"] },
      // Adam, 18 Aug 2026: "there is no obvious place for me to add a new
      // listing". The page existed at /dashboard the whole time — it just had
      // no way in from the nav, so the only route to it was the logo or the
      // back button. A list you can't navigate to may as well not exist.
      {
        href: "/dashboard",
        label: "Listings",
        Icon: Building2,
        exact: true,
        assistantSees: true,
        countKey: "listings",
        keywords: ["properties", "files", "campaigns"],
      },
      { href: "/dashboard/portfolio", label: "Office overview", Icon: LayoutGrid, keywords: ["portfolio", "team files"] },
    ],
  },
  {
    heading: "Compliance records",
    links: [
      {
        href: "/dashboard/registers",
        label: "Registers",
        Icon: FileText,
        countKey: "registers",
        keywords: ["gifts", "benefits", "complaints", "breaches", "insurance", "licence", "license", "trust"],
      },
      // One Training entry holding the plan and the log as tabs (Adam, 18 Aug
      // 2026: "training plans and training logs should be in the same
      // section"). They're two views of one thing — what a person will do
      // this year, and what they actually did.
      {
        href: "/dashboard/training",
        label: "Training",
        Icon: GraduationCap,
        assistantSees: true,
        keywords: ["training plan", "training log", "sessions"],
      },
      // CPD is its own section, NOT a tab under Training. It's a separate
      // ledger with a licence condition attached (s 20(2)) and its own
      // eligibility rule — only approved providers count. Putting it beside
      // office training is what let internal sessions accrue CPD hours.
      {
        href: "/dashboard/cpd",
        label: "CPD",
        Icon: ClipboardCheck,
        assistantSees: true,
        keywords: ["continuing professional development", "hours"],
      },
      // Trust accounts got its own entry on 25 Aug 2026, having been the sixth
      // tab inside Registers for a few hours. Several named accounts, a monthly
      // cadence and real penalties made it too big to sit in a tab strip.
      {
        href: "/dashboard/trust",
        label: "Trust accounts",
        Icon: Landmark,
        countKey: "trust",
        keywords: ["reconciliation", "reconciliations", "audit", "bank", "sales trust", "property management trust"],
      },
      {
        href: "/dashboard/document-signoffs",
        label: "Sign-offs",
        Icon: PenLine,
        countKey: "signoffs",
        keywords: ["signatures", "reconciliation", "trust account"],
      },
    ],
  },
  {
    heading: "Agency",
    links: [
      {
        href: "/dashboard/sg-manual",
        label: "SG Manual",
        Icon: BookOpen,
        keywords: ["supervision guidelines", "policies", "manual"],
      },
      { href: "/dashboard/team", label: "Team", Icon: Users, keywords: ["staff", "agents", "invite"] },
    ],
  },
];

/** Flat list, for search. */
export const NAV_LINKS: NavLink[] = NAV_GROUPS.flatMap((g) => g.links);
