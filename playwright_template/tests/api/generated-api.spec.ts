import { test, expect } from '@playwright/test';

test.describe('API Tests: Payment API', () => {
  
  test('GET /api/health - should return healthy status', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status', 'healthy');
    expect(body).toHaveProperty('message', 'Server is running');
    expect(typeof body.status).toBe('string');
    expect(typeof body.message).toBe('string');
  });

  test('POST /api/validate-card - happy path with valid Luhn card', async ({ request }) => {
    const response = await request.post('/api/validate-card', {
      data: {
        cardNumber: '4242424242424242'
      }
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('valid', true);
    expect(body).toHaveProperty('message');
    expect(typeof body.valid).toBe('boolean');
    expect(typeof body.message).toBe('string');
  });

  test('POST /api/validate-card - negative path with invalid Luhn card', async ({ request }) => {
    const response = await request.post('/api/validate-card', {
      data: {
        cardNumber: '1234567890123456'
      }
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('valid', false);
    expect(body).toHaveProperty('message');
    expect(typeof body.valid).toBe('boolean');
    expect(typeof body.message).toBe('string');
    expect(body.message).toContain('Luhn check failed');
  });

  test('POST /api/validate-card - bad request path with malformed payload', async ({ request }) => {
    const response = await request.post('/api/validate-card', {
      data: {
        cardNumber: 1234567890123456 // passing number instead of string
      }
    });
    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });

  test('POST /api/validate-email - should simulate third-party outage returning 500', async ({ request }) => {
    const response = await request.post('/api/validate-email', {
      data: {
        email: 'user@example.com'
      }
    });
    expect(response.status()).toBe(500);

    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error).toContain('Email validation service temporarily unavailable');
  });

  test('POST /api/checkout - happy path with valid payment details', async ({ request }) => {
    const response = await request.post('/api/checkout', {
      data: {
        cardNumber: '4242 4242 4242 4242',
        expiry: '12/26',
        cvv: '123',
        amount: 50.00
      }
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status', 'success');
    expect(body).toHaveProperty('message', 'Payment processed successfully!');
    expect(typeof body.status).toBe('string');
    expect(typeof body.message).toBe('string');
  });

  test('POST /api/checkout - bad request path with malformed amount payload', async ({ request }) => {
    const response = await request.post('/api/checkout', {
      data: {
        cardNumber: '4242 4242 4242 4242',
        expiry: '12/26',
        cvv: '123',
        amount: 'invalid-amount' // failing float64 JSON decoding
      }
    });
    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });

});