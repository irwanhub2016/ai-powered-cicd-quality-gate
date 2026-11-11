import { test, expect } from '@playwright/test';

test.describe('Checkout Flow E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Happy Path - Full Checkout Completion', async ({ page }) => {
    // Intercept API routes
    await page.route('**/api/validate-email', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: true }),
      });
    });

    await page.route('**/api/validate-card', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: true }),
      });
    });

    await page.route('**/api/checkout', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Payment processed successfully!' }),
      });
    });

    // Fill in valid test data and trigger blur events
    const emailInput = page.locator('input[name="email"]');
    await emailInput.fill('shopper@example.com');
    await emailInput.blur();

    const cardInput = page.locator('input[name="cardNumber"]');
    await cardInput.fill('4242 4242 4242 4242');
    await cardInput.blur();

    await page.locator('input[name="expiry"]').fill('12/26');
    await page.locator('input[name="cvv"]').fill('123');
    await page.locator('input[name="amount"]').fill('50.00');

    // Click the submit button
    await page.locator('button[type="submit"]').click();

    // Verify success message
    await expect(page.locator('text=✅ Payment processed successfully!')).toBeVisible();
  });

  test('Negative Path - Invalid Card Validation', async ({ page }) => {
    // Intercept validate-card route to return invalid status
    await page.route('**/api/validate-card', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: false, message: 'Invalid card number (Luhn check failed)' }),
      });
    });

    // Fill an invalid card number and trigger blur
    const cardInput = page.locator('input[name="cardNumber"]');
    await cardInput.fill('1234 5678 9012 3456');
    await cardInput.blur();

    // Verify validation error indicator is shown
    await expect(page.locator('text=Invalid card number')).toBeVisible();

    // Fill remaining fields to satisfy HTML5 form validation
    await page.locator('input[name="email"]').fill('shopper@example.com');
    await page.locator('input[name="expiry"]').fill('12/26');
    await page.locator('input[name="cvv"]').fill('123');
    await page.locator('input[name="amount"]').fill('50.00');

    // Click submit button
    await page.locator('button[type="submit"]').click();

    // Assert error notification is visible
    await expect(page.locator('text=❌ Please enter a valid card number')).toBeVisible();
  });

  test('Resiliency / Soft-Fail Behavior', async ({ page }) => {
    // Intercept validate-email to return 500 Internal Server Error
    await page.route('**/api/validate-email', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      });
    });

    // Enter email address and trigger blur
    const emailInput = page.locator('input[name="email"]');
    await emailInput.fill('shopper@example.com');
    await emailInput.blur();

    // Verify soft-fail warning message is visible
    await expect(page.locator('text=⚠️ Email validation service temporarily unavailable. You can still proceed.')).toBeVisible();

    // Verify submit button remains enabled and can proceed
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeEnabled();
  });

  test('Health Check Verification', async ({ page }) => {
    // Intercept health check API route
    await page.route('**/api/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'healthy', message: 'Server is running' }),
      });
    });

    // Click the Check Backend Status button
    await page.locator('button:has-text("🔌 Check Backend Status")').click();

    // Verify backend status notification
    await expect(page.locator('text=🟢 Backend Status: healthy - Server is running')).toBeVisible();
  });
});