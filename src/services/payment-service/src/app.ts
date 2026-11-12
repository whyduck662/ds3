import type { Pool } from 'pg';
import { authenticate, createApp, fail } from '../../../common/src/platform.js';

export async function paymentApp(pool: Pool) {
  const app = await createApp('payment-service', pool);

  // GET /payments/:tripId - Public route qua Gateway
  app.get<{ Params: { tripId: string } }>('/payments/:tripId', async (req) => {
    await authenticate(req);
    const { tripId } = req.params;

    const { rows } = await pool.query(
      'SELECT trip_id, passenger_id, amount, status FROM payments WHERE trip_id = $1',
      [tripId]
    );

    if (rows.length === 0) {
      fail(404, 'NOT_FOUND', 'Không tìm thấy thông tin thanh toán');
    }

    const payment = rows[0];
    if (req.user.role !== 'ADMIN' && payment.passenger_id && payment.passenger_id !== req.user.userId) {
      fail(403, 'FORBIDDEN', 'Không có quyền truy cập thông tin thanh toán của chuyến đi này');
    }

    return {
      tripId: payment.trip_id,
      status: payment.status,
      amount: payment.amount
    };
  });

  // GET /internal/payments/:tripId/status - Tra cứu nội bộ để Reconciler đối soát
  app.get<{ Params: { tripId: string } }>('/internal/payments/:tripId/status', async (req) => {
    const { tripId } = req.params;
    const { rows } = await pool.query(
      'SELECT trip_id, passenger_id, amount, status, version FROM payments WHERE trip_id = $1',
      [tripId]
    );

    if (rows.length === 0) {
      fail(404, 'NOT_FOUND', 'Không tìm thấy thanh toán');
    }

    const payment = rows[0];
    return {
      tripId: payment.trip_id,
      status: payment.status,
      amount: payment.amount,
      version: payment.version
    };
  });

  return app;
}

