import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * P01 Performance & Scalability Test (k6)
 * Target: API Gateway (http://localhost:8080)
 * Evaluates p50, p95, throughput, request-to-assignment latency under 10/50/100 VUs.
 */

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // p95 should be under 2s
    http_req_failed: ['rate<0.05'],    // errors below 5%
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:8080';

export function setup() {
  // Login as passenger
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({
      email: 'passenger1@demo.local',
      password: 'DemoPass123!',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const token = loginRes.json('accessToken');
  return { token };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
    'Idempotency-Key': `k6-${__VU}-${__ITER}-${Date.now()}`,
  };

  const payload = JSON.stringify({
    pickup: {
      lat: 10.7769 + (Math.random() - 0.5) * 0.02,
      lng: 106.7009 + (Math.random() - 0.5) * 0.02,
    },
    dropoff: {
      lat: 10.7850 + (Math.random() - 0.5) * 0.02,
      lng: 106.7100 + (Math.random() - 0.5) * 0.02,
    },
  });

  const res = http.post(`${BASE_URL}/trips`, payload, { headers });

  check(res, {
    'trip created (200/201)': (r) => r.status === 200 || r.status === 201,
    'has trip id': (r) => r.json('id') !== undefined,
  });

  sleep(1);
}

