CREATE TABLE IF NOT EXISTS processed_messages (
  event_id uuid PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id uuid NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  trip_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY,
  passenger_id uuid NOT NULL,
  driver_id uuid,
  reservation_id uuid,
  reservation_version integer,
  pickup_lat double precision NOT NULL,
  pickup_lng double precision NOT NULL,
  dropoff_lat double precision NOT NULL,
  dropoff_lng double precision NOT NULL,
  quoted_fare integer NOT NULL CHECK (quoted_fare > 0),
  status text NOT NULL CHECK (status IN (
    'REQUESTED', 'SEARCHING', 'DRIVER_ASSIGNED', 'ACCEPTING',
    'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'PAID',
    'COMPENSATING', 'CANCELLED'
  )),
  payment_status text CHECK (payment_status IN (
    'PENDING', 'AUTHORIZED', 'CAPTURE_PENDING', 'CAPTURED', 'VOIDED', 'DECLINED'
  )),
  saga_status text NOT NULL DEFAULT 'RUNNING' CHECK (saga_status IN (
    'RUNNING', 'COMPENSATING', 'COMPLETED', 'CANCELLED'
  )),
  match_attempt integer NOT NULL DEFAULT 0,
  rejected_driver_ids uuid[] NOT NULL DEFAULT '{}',
  comp_match_ack boolean NOT NULL DEFAULT false,
  comp_driver_ack boolean NOT NULL DEFAULT false,
  comp_payment_ack boolean NOT NULL DEFAULT false,
  cancel_reason text,
  correlation_id uuid NOT NULL,
  saga_deadline timestamptz,
  offer_deadline timestamptz,
  accepting_since timestamptz,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- I03: Một Passenger có tối đa 1 Trip chưa kết thúc
CREATE UNIQUE INDEX IF NOT EXISTS one_active_trip ON trips(passenger_id) WHERE status NOT IN ('PAID', 'CANCELLED');

CREATE INDEX IF NOT EXISTS trips_passenger_idx ON trips(passenger_id);
CREATE INDEX IF NOT EXISTS trips_driver_idx ON trips(driver_id);

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

