import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { createApp, fail } from '../../../common/src/platform.js';

function verifyInternal(req: FastifyRequest) {
  const token = req.headers['x-internal-token'];
  const expected = process.env.INTERNAL_TOKEN;
  if (expected && token !== expected) {
    fail(403, 'FORBIDDEN', 'Token nội bộ không hợp lệ');
  }
}

export async function matchingApp(pool: Pool) {
  const app = await createApp('matching-service', pool);

  app.get('/internal/matching/:tripId/:attempt', async (req) => {
    verifyInternal(req);
    const params = z.object({
      tripId: z.string().uuid(),
      attempt: z.coerce.number().int().nonnegative()
    }).parse(req.params);

    const result = await pool.query(
      `SELECT id, trip_id AS "tripId", attempt, status,
              candidate_driver_id AS "candidateDriverId",
              reservation_id AS "reservationId",
              claim_token AS "claimToken",
              claimed_until AS "claimedUntil",
              claimed_by AS "claimedBy",
              correlation_id AS "correlationId",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM match_attempts
       WHERE trip_id = $1 AND attempt = $2`,
      [params.tripId, params.attempt]
    );

    if (!result.rowCount) {
      fail(404, 'ATTEMPT_NOT_FOUND', 'Không tìm thấy attempt matching');
    }

    return result.rows[0];
  });

  return app;
}

