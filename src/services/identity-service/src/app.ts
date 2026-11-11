import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Pool } from 'pg';
import { authenticate, createApp, fail } from '../../../common/src/platform.js';

const credentials = z.object({ email: z.email().max(254).transform(v => v.toLowerCase()), password: z.string().min(8).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Mật khẩu tối đa 72 byte UTF-8') });
export async function identityApp(pool: Pool) {
  const app = await createApp('identity-service', pool);
  app.post('/auth/register', async (req, reply) => {
    const input = credentials.extend({ name: z.string().trim().min(1).max(100), role: z.enum(['PASSENGER', 'DRIVER']) }).strict().parse(req.body);
    const hash = await bcrypt.hash(input.password, 12);
    const result = await pool.query('INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id AS "userId",email,name,role', [input.email, input.name, hash, input.role]);
    if (!result.rowCount) fail(409, 'EMAIL_EXISTS', 'Email đã được đăng ký');
    req.log.info({ operation: 'USER_REGISTERED', userId: result.rows[0].userId, correlationId: req.id, result: 'SUCCESS' });
    return reply.code(201).send(result.rows[0]);
  });
  app.post('/auth/login', async req => {
    const input = credentials.strict().parse(req.body);
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [input.email]);
    const user = result.rows[0];
    // Hash giả giữ chi phí so sánh tương tự khi email không tồn tại.
    const valid = await bcrypt.compare(input.password, user?.password_hash ?? '$2b$12$C6UzMDM.H6dfI/f/IKcEe.yr6Ml8aCXmDTfhUwTv4iY1oLq7LZrKm');
    if (!user || !valid) {
      req.log.info({ operation: 'LOGIN', correlationId: req.id, result: 'DENIED' });
      fail(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng');
    }
    req.log.info({ operation: 'LOGIN', userId: user.id, correlationId: req.id, result: 'SUCCESS' });
    return { accessToken: app.jwt.sign({ userId: user.id, role: user.role }), expiresIn: 900, user: { userId: user.id, name: user.name, role: user.role } };
  });
  app.get('/users/me', { preHandler: authenticate }, async req => {
    const result = await pool.query('SELECT id AS "userId",email,name,role FROM users WHERE id=$1', [req.user.userId]);
    if (!result.rowCount) fail(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng');
    return result.rows[0];
  });
  return app;
}
