-- AI triage of monitoring items: how much a story matters to this campaign and
-- why. Null on rows captured before triage existed (treated as 'relevant').
alter table monitoring_results
  add column if not exists triage_level text
    check (triage_level in ('attack', 'opponent_statement', 'relevant', 'noise')),
  add column if not exists triage_reason text;
