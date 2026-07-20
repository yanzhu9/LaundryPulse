const request = require('supertest');
const server = request('https://laundrypulse.onrender.com');

describe('Usage & Heatmap Statistics API', () => {
  test('GET /api/usage-heatmap-stats returns complete heatmap data with status 200', async () => {
    const res = await server.get('/api/usage-heatmap-stats');

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('updateCutoffDate');
    expect(res.body).toHaveProperty('dailyStats');
    expect(res.body).toHaveProperty('twoHourSlotStats');
    expect(res.body).toHaveProperty('machineUtilStats');
    expect(Array.isArray(res.body.dailyStats)).toBe(true);
    expect(res.body.twoHourSlotStats.length).toBe(12);
    res.body.twoHourSlotStats.forEach(item => {
      expect(item).toHaveProperty('timeRange');
      expect(item).toHaveProperty('avgLoad');
    });
    expect(res.body.machineUtilStats.length).toBe(2);
    const washerItem = res.body.machineUtilStats.find(x => x.machineType === 'washer');
    const dryerItem = res.body.machineUtilStats.find(x => x.machineType === 'dryer');
    expect(washerItem).toBeTruthy();
    expect(dryerItem).toBeTruthy();
    expect(washerItem).toHaveProperty('utilRate');
    expect(dryerItem).toHaveProperty('utilRate');
  });
});