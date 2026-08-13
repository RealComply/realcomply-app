-- Gift threshold correction: $150 → $60 (Adam, 13 Aug 2026).
--
-- The $150 in 0005_registers_expansion.sql was carried over from the early
-- clickable mock and was never a legal figure. The real number is set by
-- statute:
--
--   Property and Stock Agents Regulation 2022 (NSW), cl 20 —
--   "The amount prescribed for the Act, section 53F(2)(d) is $60."
--   (current version 1 July 2025 to date, verified 13 Aug 2026)
--
-- s53F(2)(d) of the Property and Stock Agents Act 2002 exempts a gift or
-- benefit worth *less than* the prescribed amount, so $60 is the point at
-- which the conflict-of-interest prohibition starts to bite — which is
-- exactly what the register's "flag for licensee review" status is for.
-- Leaving it at $150 meant gifts between $60 and $150 were being recorded
-- as unremarkable when they are the ones the Act actually cares about.
--
-- Two changes, both needed: the column default (for agencies created from
-- here on) and the existing rows (agencies already carrying the wrong
-- figure). The row update is deliberately scoped to rows still sitting on
-- the old 150 default, so an agency that has knowingly chosen its own
-- stricter figure is not overwritten.
--
-- Note for later: because $60 is statutory, a threshold set *above* $60 is
-- arguably non-compliant — the register would stay silent on gifts the Act
-- treats as a conflict. The field remains freely editable in the UI for
-- now; whether it should be floored at $60 (edit down, never up) is a
-- product decision flagged alongside this change, not made here.

alter table public.agencies
  alter column gift_threshold set default 60;

update public.agencies
  set gift_threshold = 60
  where gift_threshold = 150;
