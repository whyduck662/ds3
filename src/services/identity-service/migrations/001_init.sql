CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL, name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK(role IN ('PASSENGER','DRIVER','ADMIN')),
  created_at timestamptz NOT NULL DEFAULT now()
);
