const request = require('supertest');
const server = request('https://laundrypulse.onrender.com');

describe('Admin Peak Hour Setting APIs', () => {
  test('POST /api/admin/peak-setting returns valid json with incomplete body', async () => {
    const res = await server
      .post('/api/admin/peak-setting')
      .send({
        week_day: 1,
        start_hour: 14
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success');
    expect(typeof res.body.success).toBe('boolean');
  });

  test('complete peak hour parameters return standard response object', async () => {
    const res = await server
      .post('/api/admin/peak-setting')
      .send({
        week_day: 1,
        start_hour: 14,
        end_hour: 16,
        washer_max: 5,
        dryer_max: 5
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('action');
    expect(res.body).toHaveProperty('message');
  });

  test('POST /api/admin/update-peak-limit returns success json with valid parameters', async () => {
    const res = await server
      .post('/api/admin/update-peak-limit')
      .send({
        week_day: 1,
        start_hour: 14,
        washer_max: 6,
        dryer_max: 6
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('message');
  });

  test('abnormal parameter type will not crash the server', async () => {
    const res = await server
      .post('/api/admin/update-peak-limit')
      .send({
        week_day: "monday",
        start_hour: null,
        washer_max: "five",
        dryer_max: 5
      });

    expect([200, 500]).toContain(res.statusCode);
    expect(res.body).toBeInstanceOf(Object);
  });
});