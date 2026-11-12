CREATE TABLE IF NOT EXISTS processed_messages (
  event_id uuid PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  trip_id uuid PRIMARY KEY,
  passenger_id uuid,
  amount integer NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status text NOT NULL CHECK (status IN ('AUTHORIZED', 'DECLINED', 'VOIDED', 'CAPTURED', 'TOMBSTONED')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid UNIQUE NOT NULL,
  exchange text NOT NULL,
  routing_key text NOT NULL,
  envelope jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox(created_at) WHERE status = 'PENDING';

