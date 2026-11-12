CREATE TABLE IF NOT EXISTS match_attempts (
  id bigserial PRIMARY KEY,
  trip_id uuid NOT NULL,
  attempt integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','RESERVING','RESERVED','CANCEL_REQUESTED','CANCELLED','FAILED')),
  candidate_driver_id uuid,
  reservation_id uuid,
  claim_token uuid,
  claimed_until timestamptz,
  claimed_by text,
  correlation_id uuid,
  pickup_lat double precision,
  pickup_lng double precision,
  excluded_drivers uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trip_id, attempt)
);

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  event_id uuid UNIQUE NOT NULL,
  exchange text NOT NULL,
  routing_key text NOT NULL,
  envelope jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS processed_messages (
  event_id uuid PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_attempts_lookup ON match_attempts(trip_id, attempt);
CREATE INDEX IF NOT EXISTS idx_match_attempts_lease ON match_attempts(claimed_until) WHERE status IN ('RUNNING', 'RESERVING');
CREATE INDEX IF NOT EXISTS idx_matching_outbox_pending ON outbox(created_at) WHERE status = 'PENDING';

