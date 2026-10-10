import {
  BookOpen,
  Building2,
  CirclePlay,
  CreditCard,
  FileText,
  ClipboardCheck,
  GraduationCap,
  Home,
  KeyRound,
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
  /** Billing follows who pays, not the role (Adam, 8 Oct 2026): the agent on
   *  their own plan is the paying customer and gets it; an agent invited into
   *  an office does not. Shown to whoever acts as the licensee. */
  payerOnly?: boolean;
  /** Which nav count, if any, shows as a badge on this row. */
  countKey?: NavCountKey;
  /** Extra search terms. Never rendered. */
  keywords?: string[];
  /** Shown only to an agency with property management switched on (0052). */
  pmOnly?: boolean;
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
      // Property management, beside sales (brief, 6 Oct 2026). Off for every
      // agency unless agencies.pm_enabled is set, so it only appears where PM
      // is switched on.
      {
        href: "/dashboard/pm",
        label: "Property management",
        Icon: KeyRound,
        assistantSees: true,
        pmOnly: true,
        keywords: ["pm", "rentals", "tenancies", "leasing", "landlord", "tenant"],
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
        // Agents and assistants keep Registers for the gifts and breaches
        // they log themselves (Adam, 9 Oct 2026); the rest is the licensee's.
        assistantSees: true,
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
        // Only those waiting on them, for anyone but the licensee.
        assistantSees: true,
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
        // Read only for anyone but the licensee.
        assistantSees: true,
        keywords: ["supervision guidelines", "policies", "manual"],
      },
      { href: "/dashboard/team", label: "Team", Icon: Users, keywords: ["staff", "agents", "invite"] },
      // Last in the last group, deliberately. Billing is looked for when
      // something is wrong with it or when someone is signing up, and neither
      // is a daily job — putting it above the work would be a shop putting the
      // till in the doorway.
      {
        href: "/dashboard/billing",
        label: "Billing",
        Icon: CreditCard,
        payerOnly: true,
        keywords: ["subscription", "plan", "invoice", "invoices", "payment", "card", "price", "pricing", "cancel", "upgrade"],
      },
    ],
  },
  // Help, last (early access brief and mockup, 10 Oct 2026). Every role sees
  // it: assistantSees is the "everyone" marker visibleNavLink already
  // understands, so whatever a role's menu hides, this stays. Kept as its own
  // group so a change to what agents see in the groups above never touches it.
  {
    heading: "Help",
    links: [
      {
        href: "/dashboard/getting-started",
        label: "Getting started",
        Icon: CirclePlay,
        assistantSees: true,
        keywords: ["help", "video", "tour", "walkthrough", "how to", "demo"],
      },
    ],
  },
];

/** Flat list, for search. */
export const NAV_LINKS: NavLink[] = NAV_GROUPS.flatMap((g) => g.links);

/**
 * The links this viewer gets.
 *
 * REVERSAL (Adam, 7 Oct 2026). Was: only an assistant had a reduced menu, and
 * an agent saw the whole office's pages. Now an agent and an assistant get
 * the same menu (the links marked assistantSees), and Office overview, Trust
 * accounts and Team are the licensee's. Each of those pages also refuses a
 * typed address (requireLicenseePage), and the database rules (0058) are what
 * actually keep the records out of reach.
 */
export function visibleNavLink(
  link: NavLink,
  viewer: { actsAsLicensee: boolean; pmEnabled: boolean },
): boolean {
  if (link.pmOnly && !viewer.pmEnabled) return false;
  if (viewer.actsAsLicensee) return true;
  if (link.payerOnly) return false;
  return link.assistantSees === true;
}
