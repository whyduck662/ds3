import { z } from 'zod';
import type { Pool } from 'pg';
import { authenticate, createApp } from '../../../common/src/platform.js';

// Payload contract bàn giao TV2: passengerId bắt buộc, driverId nếu đã gán.
export const tripEvent = z.object({
  eventId: z.uuid(), type: z.enum(['trip.requested','trip.accepted','trip.started','trip.completed','trip.cancelled','trip.paid']),
  schemaVersion: z.literal(1), occurredAt: z.iso.datetime(), correlationId: z.uuid(), causationId: z.uuid().nullable(),
  producer: z.object({ service: z.string().min(1), instanceId: z.string().min(1) }),
  aggregateId: z.uuid(), aggregateVersion: z.number().int().nonnegative(), matchAttempt: z.number().int().nonnegative(),
  payload: z.object({ tripId: z.uuid(), passengerId: z.uuid(), driverId: z.uuid().nullable().optional() })
}).refine(e => e.aggregateId === e.payload.tripId, 'aggregateId phải bằng tripId');

export async function saveNotification(pool: Pool, input: unknown) {
  const event = tripEvent.parse(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inbox = await client.query('INSERT INTO processed_messages(event_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_id', [event.eventId]);
    if (inbox.rowCount) {
      for (const userId of new Set([event.payload.passengerId, event.payload.driverId].filter(Boolean))) {
        await client.query('INSERT INTO notifications(user_id,event_id,type,trip_id,aggregate_version,correlation_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [userId,event.eventId,event.type,event.payload.tripId,event.aggregateVersion,event.correlationId]);
      }
    }
    await client.query('COMMIT');
    return { duplicate: !inbox.rowCount, event };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function notificationApp(pool: Pool) {
  const app = await createApp('notification-service', pool);
  app.get('/notifications/me', { preHandler: authenticate }, async req => {
    const query = z.object({ since: z.iso.datetime().optional() }).strict().parse(req.query);
    const result = await pool.query('SELECT id,type,trip_id AS "tripId",event_id AS "eventId",aggregate_version AS "aggregateVersion",correlation_id AS "correlationId",created_at AS "createdAt" FROM notifications WHERE user_id=$1 AND ($2::timestamptz IS NULL OR created_at>$2) ORDER BY created_at,id LIMIT 200', [req.user.userId, query.since ?? null]);
    return { items: result.rows };
  });
  return app;
}
