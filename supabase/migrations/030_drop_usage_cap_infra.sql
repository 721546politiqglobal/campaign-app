-- Task 15: drop dollar-cap enforcement infra now superseded by self-serve
-- per-feature quotas. monthly_cost_cap_cents stays on campaigns (unused) and
-- usage_events stays as an audit/analytics log per the design spec's rollout
-- note — only the enforcement plumbing is removed here.
drop function if exists reserve_usage(text, integer, integer);
drop function if exists finalize_usage(text, text, integer);
drop table if exists usage_sync_cursor;
