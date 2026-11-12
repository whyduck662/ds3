# @ds03/common

Shared platform utilities for the DS03 ride-hailing microservices monorepo.

## Core platform

- `src/platform.ts` — HTTP app factory, JWT claims, standard errors, PG connection pool.
- `src/serve.ts` — Listen helper and graceful shutdown.
- `src/migrate.ts` — SQL migrations with version tracking, transactions, and advisory locks.

---

## Messaging module

The messaging module provides a **reliable, exactly-once RabbitMQ infrastructure** used by all services. It is composed of four files:

### `messaging.ts` — Envelope & outbox primitives + re-exports

| Export | Purpose |
|--------|---------|
| `envelopeSchema` | Zod schema for the standard message envelope |
| `Envelope<T>` | TypeScript type for a typed envelope |
| `createEnvelope(params)` | Factory that builds a new envelope with a fresh UUID |
| `insertOutbox(client, params)` | Inserts a message into the transactional outbox table |
| `isProcessed(client, eventId)` | Checks the `processed_messages` (inbox) table |
| `markProcessed(client, eventId)` | Inserts into `processed_messages` for deduplication |

All rabbit/consumer/outbox exports are **re-exported from `messaging.ts`** for convenience.

### `rabbit.ts` — RabbitMQ connection & topology

#### `connectBroker(url: string)`

Creates a managed AMQP connection and returns `{ connection, channelWrapper }`.
The channel wrapper uses **publisher confirms** so every publish is guaranteed to reach the broker.

#### `setupTopology(channel)`

Declares the full exchange/queue topology:

**Exchanges:**

| Exchange | Type | Purpose |
|----------|------|---------|
| `ride.commands` | direct | Command routing to service queues |
| `ride.events` | topic | Event fan-out with wildcard routing |
| `ride.retry` | direct | Retry-tier routing |
| `ride.dlq` | direct | Dead-letter routing |

**Queues & bindings:**

| Queue | ← Exchange | Routing key |
|-------|-----------|-------------|
| `payment.commands` | `ride.commands` | `payment.commands` |
| `matching.commands` | `ride.commands` | `matching.commands` |
| `driver.commands` | `ride.commands` | `driver.commands` |
| `trip.replies` | `ride.commands` | `trip.replies` |
| `trip.driver-events` | `ride.events` | `driver.*` |
| `driver.trip-events` | `ride.events` | `trip.*` |
| `notification.events` | `ride.events` | `trip.*` |

**Retry & DLQ queues** (per main queue):

For each main queue `<Q>`, three retry queues and one DLQ are created:

- `<Q>.retry.1s` — 1 second TTL, dead-letters back to `<Q>`
- `<Q>.retry.5s` — 5 second TTL, dead-letters back to `<Q>`
- `<Q>.retry.15s` — 15 second TTL, dead-letters back to `<Q>`
- `<Q>.dlq` — final dead-letter queue

All queues are **durable** and messages use `delivery_mode=2` (persistent).

### `consumer.ts` — Reliable message consumer

#### `startConsumer(params)`

```typescript
interface ConsumerParams {
  channelWrapper: ChannelWrapper;
  pool: Pool;
  queue: string;
  prefetch?: number;          // default 5
  handler: (envelope: Envelope, client: PoolClient) => Promise<void>;
  logger: FastifyBaseLogger;
}
```

Processing pipeline:

1. **Parse** — Validates the raw message against `envelopeSchema`.
2. **Inbox dedup** — Checks `processed_messages`. If already seen → **ACK** + log `MESSAGE_DEDUPED`.
3. **Transaction** — `BEGIN` → `markProcessed` → `handler(envelope, client)` → `COMMIT` → **ACK** + log `MESSAGE_PROCESSED`.
4. **Transient error** — Reads `x-retry-count` header. If < 3: republish to the appropriate retry queue (`ride.retry` exchange), increment count, publisher-confirm, then ACK original → log `RETRY_SCHEDULED`. If ≥ 3: send to DLQ → log `DLQ`.
5. **Permanent / schema error** — Send directly to DLQ → log `DLQ`.

**Safety guarantees:**
- **Never ACK before DB commit.** If the DB transaction fails, the message is retried.
- **Never ACK if retry/DLQ publish fails.** The broker will redeliver the original.

### `outbox.ts` — Transactional outbox poller

#### `startOutboxPoller(pool, channelWrapper, logger?, intervalMs?)`

Polls the `outbox` table for `PENDING` messages, publishes them with publisher confirms, and marks them `SENT`. Uses `FOR UPDATE SKIP LOCKED` for safe concurrent polling.

Returns `{ trigger(), stop() }`.

## Usage example

```typescript
import {
  connectBroker,
  setupTopology,
  startConsumer,
  startOutboxPoller,
  createEnvelope,
  insertOutbox,
} from '@ds03/common/src/messaging.js';

// 1. Connect
const { connection, channelWrapper } = connectBroker(process.env.AMQP_URL!);

// 2. Declare topology (typically in service startup)
await channelWrapper.addSetup(setupTopology);

// 3. Start consuming
await startConsumer({
  channelWrapper,
  pool,
  queue: 'payment.commands',
  handler: async (envelope, client) => {
    // your business logic, inside the same DB transaction
  },
  logger,
});

// 4. Start outbox poller (for publishing)
const poller = startOutboxPoller(pool, channelWrapper, logger);
```
