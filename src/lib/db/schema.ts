export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  timezone TEXT NOT NULL,
  microsoft_tenant_id TEXT,
  timing_json TEXT NOT NULL,
  briefing_cap INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  autonomy TEXT NOT NULL DEFAULT 'suggest_only',
  voice_notes TEXT NOT NULL DEFAULT '',
  briefing_hour INTEGER NOT NULL DEFAULT 7,
  workday_start INTEGER NOT NULL DEFAULT 8,
  workday_end INTEGER NOT NULL DEFAULT 18,
  microsoft_oid TEXT,
  microsoft_refresh_token TEXT,
  microsoft_access_token TEXT,
  microsoft_token_expires TEXT,
  mail_sync_cursor TEXT,
  crm_provider TEXT NOT NULL DEFAULT 'local',
  crm_access_token TEXT,
  crm_refresh_token TEXT,
  crm_token_expires TEXT,
  crm_user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  email TEXT,
  company TEXT,
  external_crm_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  domain TEXT,
  website TEXT,
  industry TEXT,
  motion TEXT,
  summary TEXT NOT NULL DEFAULT '',
  external_crm_id TEXT,
  is_prospect INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  account_id TEXT REFERENCES accounts(id),
  partner_id TEXT REFERENCES partners(id),
  kind TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone TEXT,
  title TEXT,
  role TEXT NOT NULL DEFAULT 'unknown',
  role_confidence REAL,
  role_confirmed INTEGER NOT NULL DEFAULT 0,
  timezone TEXT,
  summary TEXT NOT NULL DEFAULT '',
  typical_response_days REAL,
  external_crm_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  account_id TEXT REFERENCES accounts(id),
  owner_user_id TEXT REFERENCES users(id),
  partner_id TEXT REFERENCES partners(id),
  name TEXT NOT NULL,
  stage TEXT NOT NULL,
  value_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  motion TEXT,
  close_on TEXT,
  origination_path TEXT NOT NULL DEFAULT 'unknown',
  summary TEXT NOT NULL DEFAULT '',
  contract_type TEXT,
  external_crm_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loops (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT REFERENCES accounts(id),
  contact_id TEXT REFERENCES contacts(id),
  opportunity_id TEXT REFERENCES opportunities(id),
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  due_on TEXT,
  due_stated INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  source_excerpt TEXT NOT NULL DEFAULT '',
  source_at TEXT NOT NULL,
  thread_key TEXT,
  nudge_stage INTEGER NOT NULL DEFAULT 0,
  last_nudged_at TEXT,
  next_action_at TEXT,
  next_channel TEXT,
  snooze_until TEXT,
  suppressed INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  closed_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loop_events (
  id TEXT PRIMARY KEY,
  loop_id TEXT NOT NULL REFERENCES loops(id),
  user_id TEXT,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  external_id TEXT NOT NULL,
  thread_key TEXT,
  direction TEXT NOT NULL,
  from_email TEXT,
  from_name TEXT,
  to_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  is_business INTEGER NOT NULL,
  filter_reason TEXT,
  account_id TEXT,
  contact_id TEXT,
  processed_at TEXT NOT NULL,
  UNIQUE (user_id, external_id)
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  external_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  attendees_json TEXT NOT NULL DEFAULT '[]',
  body_text TEXT NOT NULL DEFAULT '',
  processed_at TEXT,
  UNIQUE (user_id, external_id)
);

CREATE TABLE IF NOT EXISTS meeting_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL,
  echo TEXT NOT NULL DEFAULT '',
  account_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS briefings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  briefing_date TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  delivered_at TEXT,
  delivery_message_id TEXT,
  cap INTEGER NOT NULL,
  UNIQUE (user_id, briefing_date)
);

CREATE TABLE IF NOT EXISTS briefing_items (
  id TEXT PRIMARY KEY,
  briefing_id TEXT NOT NULL REFERENCES briefings(id),
  loop_id TEXT NOT NULL REFERENCES loops(id),
  rank INTEGER NOT NULL,
  score INTEGER NOT NULL,
  score_json TEXT NOT NULL DEFAULT '{}',
  evidence TEXT NOT NULL,
  draft_subject TEXT NOT NULL,
  draft_body TEXT NOT NULL,
  draft_to TEXT,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  acted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  loop_id TEXT,
  briefing_item_id TEXT,
  kind TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback_signals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  loop_kind TEXT NOT NULL,
  account_id TEXT,
  signal TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Phase 3. Present so contracts are an extension, not a new model.
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  account_id TEXT REFERENCES accounts(id),
  opportunity_id TEXT REFERENCES opportunities(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  effective_on TEXT,
  ends_on TEXT,
  auto_renew INTEGER,
  notice_days INTEGER,
  source_excerpt TEXT,
  confidence REAL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  external_crm_id TEXT,
  created_at TEXT NOT NULL
);

-- Phase 3 org map. Inferred lines stay unconfirmed until a seller accepts them.
CREATE TABLE IF NOT EXISTS org_relationships (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  from_contact_id TEXT NOT NULL REFERENCES contacts(id),
  to_contact_id TEXT NOT NULL REFERENCES contacts(id),
  relation TEXT NOT NULL,
  confidence REAL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS loops_owner_status ON loops(owner_user_id, status);
CREATE INDEX IF NOT EXISTS audit_org_created ON audit_log(org_id, created_at);
`;
