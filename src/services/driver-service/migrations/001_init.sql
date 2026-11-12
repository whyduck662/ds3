CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY,  -- same as userId from JWT
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'OFFLINE' CHECK(status IN ('AVAILABLE','RESERVED','ON_TRIP','OFFLINE')),
  latitude double precision,
  longitude double precision,
  current_trip_id uuid,
  reservation_id uuid,
  reservation_version integer NOT NULL DEFAULT 0,
  reserved_until timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
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

CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);
CREATE INDEX IF NOT EXISTS idx_drivers_reserved_until ON drivers(reserved_until) WHERE status='RESERVED';
CREATE INDEX IF NOT EXISTS idx_driver_outbox_pending ON outbox(created_at) WHERE status='PENDING';
