const request = require('supertest');
const server = request('https://laundrypulse.onrender.com');

describe('Machine related API tests', () => {

  test('GET /machines returns valid machine array with status 200', async () => {
    const res = await server.get('/machines');

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('machine_id');
      expect(res.body[0]).toHaveProperty('machine_status');
    }
  });

  describe('POST /api/machines/:id/start', () => {

    test('returns 404 if machine id does not exist', async () => {
      const res = await server
        .post('/api/machines/W-99999/start')
        .send({
          needs_dryer: true,
          mode: 30
        });

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('receives standard json response with correct request body structure', async () => {
      const res = await server
        .post('/api/machines/W-01/start')
        .send({
          needs_dryer: false,
          mode: 45
        });

      expect([200, 400, 404, 500]).toContain(res.statusCode);
      expect(res.body).toHaveProperty('success');
      expect(typeof res.body.success).toBe('boolean');
    });
  });
});