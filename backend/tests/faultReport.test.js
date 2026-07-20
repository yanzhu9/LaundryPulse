const request = require('supertest');
const server = request('https://laundrypulse.onrender.com');

describe('Fault Report related APIs', () => {
  test('POST /api/create-fault-report returns false when required fields are empty', async () => {
    const res = await server
      .post('/api/create-fault-report')
      .send({
        facilityType: "",
        facilityNumber: "W-01",
        faultDesc: "water leaking",
        submitUserId: "u123"
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
  });

  test('reject unsupported facility type and return error message', async () => {
    const res = await server
      .post('/api/create-fault-report')
      .send({
        facilityType: "fridge",
        facilityNumber: "W-01",
        faultDesc: "water leaking seriously",
        submitUserId: "user001"
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
  });

  test('accept complete valid body structure and return standard json format', async () => {
    const res = await server
      .post('/api/create-fault-report')
      .send({
        facilityType: "washer",
        facilityNumber: "W-01",
        faultDesc: "The machine cannot drain water normally",
        submitUserId: "test_user_001"
      });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success');
    expect(typeof res.body.success).toBe('boolean');
  });

  test('GET /api/get-all-fault-list returns standard json structure with fault_list array', async () => {
    const res = await server.get('/api/get-all-fault-list');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success');
    expect(res.body).toHaveProperty('fault_list');
    expect(Array.isArray(res.body.fault_list)).toBe(true);
  });

  test('POST /api/mark-fault-fixed returns false with empty parameters', async () => {
    const res = await server
      .post('/api/mark-fault-fixed')
      .send({
        record_id: "",
        facility_type: "washer",
        facility_number: "W-01"
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body).toHaveProperty('msg');
  });
  test('mark fault fixed with full body returns correct json structure', async () => {
    const res = await server
      .post('/api/mark-fault-fixed')
      .send({
        record_id: "test_rec_001",
        facility_type: "washer",
        facility_number: "W-01"
      });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success');
  });
});