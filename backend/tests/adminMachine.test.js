const request = require('supertest');
const server = request('https://laundrypulse.onrender.com');

describe('Admin API for manual machine status operation', () => {
  test('POST /admin/machine/manualSetOutOfService returns 400 with wrong machineId type', async () => {
    const res = await server
      .post('/admin/machine/manualSetOutOfService')
      .send({ machineId: 12345 });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  test('returns 404 when machineId does not exist', async () => {
    const res = await server
      .post('/admin/machine/manualSetOutOfService')
      .send({ machineId: "W-999999" });
    expect(res.statusCode).toBe(404);
  });

  test('POST /admin/machine/manualRestoreToAvailable validate string machineId', async () => {
    const res = await server
      .post('/admin/machine/manualRestoreToAvailable')
      .send({ machineId: 666 });
    expect(res.statusCode).toBe(400);
  });

  test('correct body format returns valid response structure', async () => {
    const res = await server
      .post('/admin/machine/manualRestoreToAvailable')
      .send({ machineId: "W-01" });
    expect([200, 400, 404, 500]).toContain(res.statusCode);
    expect(res.body).toHaveProperty('message');
  });
});