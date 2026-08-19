import Script from "next/script";

const META_PIXEL_ID = "1040730458604238";

/**
 * Meta advertising pixel — MARKETING PAGES ONLY.
 *
 * This used to sit in the root layout, which meant it loaded on every page in
 * the product, including the signed-in dashboard. Facebook was therefore being
 * told, on every page view, that a logged-in user had visited a URL like
 * /dashboard/<property-id>/summary. No addresses or vendor details were in
 * those URLs — but "our advertising pixel runs inside the compliance app" is
 * not an answer any agency wants to hear when they ask where their clients'
 * data goes, and it is not a thing a compliance product should have to
 * explain away.
 *
 * Found 19 Aug 2026 while writing up the data-residency answer for a
 * prospective customer. Keep it on the public marketing pages, where it does
 * its job, and nowhere else. If a new marketing page is added, add this
 * component to it explicitly — do NOT put it back in a shared layout that the
 * app sits under.
 */
export function MetaPixel() {
  return (
    <>
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
    </>
  );
}
