jest.mock('../src/config/db', () => ({
  query: jest.fn()
}));

process.env.JWT_SECRET = 'test-secret-for-skybook-automated-tests-123456';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const pool = require('../src/config/db');

describe('SkyBook API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Health check', () => {
    test('returns 200 when database is connected', async () => {
      pool.query.mockResolvedValue([[], []]);

      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        database: 'connected'
      });
    });

    test('returns 500 when database connection fails', async () => {
      pool.query.mockRejectedValue(new Error('Database failed'));

      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app).get('/api/health');

      expect(response.status).toBe(500);

      errorSpy.mockRestore();
    });
  });

  describe('404 handling', () => {
    test('returns 404 for an unknown endpoint', async () => {
      const response = await request(app).get('/api/unknown');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe(
        'API endpoint not found.'
      );
    });
  });

  describe('Security headers', () => {
    test('includes Helmet security headers', async () => {
      pool.query.mockResolvedValue([[], []]);

      const response = await request(app).get('/api/health');

      expect(response.headers['x-content-type-options'])
        .toBe('nosniff');
    });
  });

  describe('Authentication and authorization', () => {
    test('rejects unauthenticated users from booking endpoints', async () => {
      const response = await request(app)
        .get('/api/bookings');

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Please sign in.');
    });

    test('rejects CUSTOMER users from admin flight creation', async () => {
      const token = jwt.sign(
        {
          id: 1,
          email: 'customer@example.com',
          role: 'CUSTOMER'
        },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      const response = await request(app)
        .post('/api/flights')
        .set('Cookie', `flight_session=${token}`)
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(
        'Administrator access required.'
      );
    });
  });
});

