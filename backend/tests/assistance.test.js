const request = require('supertest');
const server = request('https://laundrypulse.onrender.com');

describe('Assistance Record Related APIs (Help collect laundry & review)', () => {

  test('check-active-assist returns standard json when machine_id is empty', async () => {
    const res = await server.get('/api/check-active-assist');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body).toHaveProperty('has_active_assist');
  });

  test('check-active-assist with machine parameter returns correct structure', async () => {
    const res = await server.get('/api/check-active-assist?machine_id=W-01');
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.has_active_assist).toBe('boolean');
  });

  test('start-assist-timer returns error if parameters are missing', async () => {
    const res = await server
      .post('/api/start-assist-timer')
      .send({
        overdue_user_id: "u001",
        helper_user_id: ""
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body).toHaveProperty('message');
  });

  test('complete body for start assist returns valid json structure', async () => {
    const res = await server
      .post('/api/start-assist-timer')
      .send({
        overdue_user_id: "user101",
        helper_user_id: "user202",
        machine_id: "W-01"
      });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success');
  });

  test('submit-collect-choice rejects empty body parameters', async () => {
    const res = await server
      .post('/api/submit-collect-choice')
      .send({
        record_id: "",
        machine_id: "W-01",
        choice: "yes"
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
  });

  test('valid parameters for collect choice return standard response', async () => {
    const res = await server
      .post('/api/submit-collect-choice')
      .send({
        record_id: "test_rec_001",
        machine_id: "W-01",
        choice: "no"
      });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('new_status');
  });

  test('submit-assistance-review returns error with incomplete params', async () => {
    const res = await server
      .post('/api/submit-assistance-review')
      .send({
        record_id: "",
        overdue_user_id: "u001",
        review_result: true
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
  });

  test('get-pending-review-list returns error when user id is not passed', async () => {
    const res = await server.get('/api/get-pending-review-list');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
  });

  test('get pending review list with user id returns array structure', async () => {
    const res = await server.get('/api/get-pending-review-list?overdue_user_id=user101');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.pending_list)).toBe(true);
  });

});