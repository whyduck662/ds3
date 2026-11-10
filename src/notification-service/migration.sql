CREATE TABLE IF NOT EXISTS processed_messages(event_id uuid PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS notifications(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  event_id uuid NOT NULL, type text NOT NULL, trip_id uuid NOT NULL,
  aggregate_version integer NOT NULL, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,event_id,type)
);
CREATE INDEX IF NOT EXISTS notifications_user_time ON notifications(user_id,created_at);
