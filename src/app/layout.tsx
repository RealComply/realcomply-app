import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "RealComply",
  description: "Built by agents, for agents.",
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
