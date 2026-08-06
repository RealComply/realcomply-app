-- Adds the "agent's interest" setup question (does the agent, or a related
-- party, need to disclose a beneficial interest in this property under s49,
-- Property and Stock Agents Act 2002 (NSW)?). Same pattern as is_strata /
-- is_tenanted / has_pool: a setup-time answer that drives which compliance
-- items apply (see items a8 and c4 in src/lib/rules/nsw-sales.ts).

alter table public.properties
  add column agent_interest boolean;
