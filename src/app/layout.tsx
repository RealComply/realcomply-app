import type { Metadata } from "next";
import Script from "next/script";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Meta Pixel — RealComply Pixel, ID 1040730458604238, created in Business
// Manager 13 Aug 2026. See RealComply-meta-pixel-setup.md.
//
// In the root layout rather than the landing page because Meta needs PageView
// on every page a paid visitor might reach, not only the one the ad points at.
// The Lead event is fired separately, from EarlyAccessForm, and only after a
// signup actually succeeds — campaigns optimise against it, so firing on click
// would push the spend towards people who never finished.
const META_PIXEL_ID = "1040730458604238";

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

        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${META_PIXEL_ID}');
            fbq('track', 'PageView');
          `}
        </Script>
        <noscript>
          {/* Meta requires a plain 1x1 tracking pixel here. next/image would
              rewrite the URL through the optimiser and the beacon would never
              reach Facebook, so the lint rule genuinely does not apply. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            alt=""
            style={{ display: "none" }}
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          />
        </noscript>
      </body>
    </html>
  );
}
