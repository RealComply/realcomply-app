# RealComply

An AI compliance co-pilot for NSW real estate agents — see the RealComply project docs (Claude Project) for the product brief, rules schema, and design decisions this app is built from.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind v4)
- **Supabase** (Postgres, Auth, Storage) — Sydney region (ap-southeast-2)

## Local setup

```bash
npm install
cp .env.local.example .env.local   # fill in your Supabase project URL + anon key
```

Apply the database schema: open the Supabase dashboard's SQL Editor and run the contents of `supabase/migrations/0001_init.sql`.

```bash
npm run dev
```

## What's here so far

- Auth (Supabase Auth) with a two-role model per agency: `agent` and `licensee_in_charge` (a sole-principal agency's one user can hold both — see `is_agent`/`is_licensee_in_charge` on `profiles`).
- Multi-tenant data model (`agencies` → `profiles` → `properties` → `property_items`), locked down with Row-Level Security so one agency can never see another's data.
- Property creation with the setup questions that drive which compliance items apply later (strata, tenanted, pool).
- `property_items` is a flexible per-property checklist table (not one column per item) — the actual compliance engine (stage-by-stage items, ported from the HTML prototype, per `RealComply-rules-schema.md`) is the next build phase.

## Not yet built

- The compliance engine itself (the six-stage checklist, offers log, ESP reviews, signatures) — currently just the property record and dashboard shell exist.
- Evidence-first date extraction (AI reads an uploaded document, pre-fills the event date) — needs the Claude API wired in server-side.
- Transactional email (weekly digest, alerts) — see `RealComply-tech-stack-notes.md` for the Resend recommendation.
