import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Meta Pixel lives in components/MetaPixel.tsx and is rendered by the public
// marketing pages ONLY — deliberately not here.
//
// It was in this root layout until 19 Aug 2026, on the reasoning that Meta
// needs PageView on every page a paid visitor might reach. True of the
// marketing site; the mistake was that the signed-in product sits under this
// layout too, so the advertising pixel was also running inside the compliance
// app and reporting dashboard URLs to Facebook. Found while writing up the
// data-residency answer for a prospective customer, which is exactly the
// question that should catch it. See MetaPixel.tsx.

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "RealComply",
  // The site-wide fallback description. It read "Built by agents, for agents."
  // until 15 Aug 2026, when Adam pulled that line. It could not simply be
  // deleted: this is what search results and shared links show for any page
  // that does not set its own, so an empty one leaves Google to invent a
  // snippet. Replaced with the same wording the landing page already uses,
  // which describes the product rather than its origin.
  // Kept identical to the landing page's own description and openGraph text.
  // Updated 17 Aug 2026 with the rewrite: the old line ("AI compliance support
  // for NSW real estate agencies...") never said what the product is, which is
  // exactly the fault the rewrite exists to fix. If the three ever diverge,
  // the ad, the search result and the page start saying different things.
  description:
    "RealComply is software for NSW real estate agencies. It runs the compliance file for every listing you sell, from the agency agreement through to settlement, and builds the record as you go.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plusJakarta.variable} h-full antialiased`}>
      <head>
        {/*
          Restores the collapsed/expanded sidebar choice before first paint.
          It has to run here, ahead of the body, or the sidebar renders at its
          default width and visibly snaps to the saved one — the flash is more
          noticeable than the feature. Doing it in React state instead would
          mean either that flash or a hydration mismatch, so the choice lives
          in a class on <html> and the CSS in globals.css keys off it.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('rc-sidebar-collapsed')==='1'){document.documentElement.classList.add('rc-nav-rail')}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-white text-rc-ink">
        {children}

      </body>
    </html>
  );
}
