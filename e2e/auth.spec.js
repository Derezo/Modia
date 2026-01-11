import { test, expect } from '@playwright/test';

/**
 * Authentication E2E Tests
 *
 * Tests the login and registration flow for the game.
 */

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display login scene on initial load', async ({ page }) => {
    // Check for login form elements
    await expect(page.getByPlaceholder('Username')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /login/i })).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    // Fill in invalid credentials
    await page.getByPlaceholder('Username').fill('invaliduser');
    await page.getByPlaceholder('Password').fill('wrongpassword');

    // Click login
    await page.getByRole('button', { name: /login/i }).click();

    // Should show error message
    await expect(page.getByText(/invalid|incorrect|error/i)).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to registration from login', async ({ page }) => {
    // Click register link
    await page.getByRole('link', { name: /register|sign up|create account/i }).click();

    // Should show registration form
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Confirm Password')).toBeVisible();
  });

  test('should register a new user', async ({ page }) => {
    // Navigate to registration
    await page.getByRole('link', { name: /register|sign up|create account/i }).click();

    // Generate unique credentials
    const timestamp = Date.now();
    const username = `e2etest_${timestamp}`;
    const email = `e2etest_${timestamp}@test.com`;
    const password = 'TestPassword123!';

    // Fill registration form
    await page.getByPlaceholder('Username').fill(username);
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').first().fill(password);
    await page.getByPlaceholder('Confirm Password').fill(password);

    // Submit registration
    await page.getByRole('button', { name: /register|sign up|create/i }).click();

    // Should redirect to character select (empty state) or login success
    await expect(page).toHaveURL(/character|select|login/i, { timeout: 10000 });
  });

  test('should login with valid credentials', async ({ page }) => {
    // Use test user (created by seed or previous test)
    // Note: In real tests, you'd create a user first or use a seeded test user
    const username = 'derezo';  // Seeded dev user
    const password = 'password';

    // Fill login form
    await page.getByPlaceholder('Username').fill(username);
    await page.getByPlaceholder('Password').fill(password);

    // Click login
    await page.getByRole('button', { name: /login/i }).click();

    // Should navigate away from login
    await expect(page).not.toHaveURL(/login/i, { timeout: 10000 });
  });
});
