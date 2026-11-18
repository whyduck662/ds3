import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { fail } from './platform.js';

export function verifyInternal(request: FastifyRequest) {
  const expected = process.env.INTERNAL_TOKEN;
  if (!expected || expected.length < 16) fail(503, 'INTERNAL_AUTH_NOT_CONFIGURED', 'Chưa cấu hình xác thực nội bộ');
  const supplied = request.headers['x-internal-token'];
  if (typeof supplied !== 'string') fail(403, 'FORBIDDEN', 'Token nội bộ không hợp lệ');
  const left = Buffer.from(supplied), right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) fail(403, 'FORBIDDEN', 'Token nội bộ không hợp lệ');
}
