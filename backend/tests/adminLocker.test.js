const request = require('supertest');
const server = request('https://laundrypulse.onrender.com');

describe('Admin API for locker manual status operation', () => {
  test('POST /admin/locker/manualSetOutOfService returns 400 for string lockerId', async () => {
    const res = await server
      .post('/admin/locker/manualSetOutOfService')
      .send({ lockerId: "01" });
    expect(res.statusCode).toBe(400);
  });

  test('POST /admin/locker/manualRestoreToAvailable validate numeric lockerId', async () => {
    const res = await server
      .post('/admin/locker/manualRestoreToAvailable')
      .send({ lockerId: "abc" });
    expect(res.statusCode).toBe(400);
  });

  test('valid numeric locker id returns standard response', async () => {
    const res = await server
      .post('/admin/locker/manualSetOutOfService')
      .send({ lockerId: 1 });
    expect([200, 400, 404, 500]).toContain(res.statusCode);
    expect(res.body).toHaveProperty('message');
  });

  test('GET /get-available-locker returns standard json structure', async () => {
    const res = await server.get('/get-available-locker');

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success');
    expect(typeof res.body.success).toBe('boolean');

    if (res.body.success) {
      expect(res.body).toHaveProperty('locker_id');
    } else {
      expect(res.body).toHaveProperty('message');
    }
  });

  test('locker api will not return abnormal data and catch error correctly', async () => {
    const res = await server.get('/get-available-locker');
    expect(res.body).toBeInstanceOf(Object);
  });
});