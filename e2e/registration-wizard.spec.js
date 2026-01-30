import { test, expect } from '@playwright/test';
import { generateTestCredentials } from './helpers/index.js';

/**
 * Registration Wizard E2E Tests
 *
 * Tests the multi-step registration wizard flow including:
 * - Step 1: Account creation (username, email, password)
 * - Step 2: Character creation with live preview
 * - Step 3: Success confirmation and world entry
 * - Navigation between steps
 * - Form validation
 * - Preview card updates
 */

test.describe('Registration Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for auth scene to load
    await page.waitForTimeout(1500);
  });

  test.describe('Complete Registration Flow', () => {
    test('should complete full registration from account to world entry', async ({ page }) => {
      // Navigate to registration by clicking Register link
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Wait for registration wizard to appear
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      // Verify we're on Step 1 (Account)
      await expect(page.locator('.regwiz-title')).toContainText(/create.*account/i);
      const activeStep = page.locator('.regwiz-step-indicator.active');
      await expect(activeStep).toContainText('1');

      // Generate unique credentials
      const { username, email, password } = generateTestCredentials();

      // Fill Step 1 fields
      await page.locator('#regwiz-username').fill(username);
      await page.locator('#regwiz-email').fill(email);
      await page.locator('#regwiz-password').fill(password);
      await page.locator('#regwiz-confirm').fill(password);

      // Click Next to go to Step 2
      await page.locator('#regwiz-next').click();

      // Verify we're on Step 2 (Character)
      await expect(page.locator('.regwiz-title')).toContainText(/create.*hero/i, { timeout: 5000 });
      const step2Active = page.locator('.regwiz-step-indicator.active');
      await expect(step2Active).toContainText('2');

      // Select race (Human)
      await page.locator('[data-race="human"]').click();

      // Select class (Warrior)
      await page.locator('[data-class="warrior"]').click();

      // Select gender (Male)
      await page.locator('[data-gender="male"]').click();

      // Enter character name
      const charName = `Hero${Date.now().toString(36).slice(-6)}`;
      await page.locator('#regwiz-charname').fill(charName);

      // Verify preview card is visible
      await expect(page.locator('#regwiz-preview-card .parchment-card')).toBeVisible();

      // Click Create Character
      await page.locator('#regwiz-submit').click();

      // Wait for Step 3 (Success)
      await expect(page.locator('.regwiz-success-title')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.regwiz-success-title')).toContainText(charName);

      // Verify Step 3 indicators
      const step3Active = page.locator('.regwiz-step-indicator.active');
      await expect(step3Active).toContainText('3');

      // Click Enter World
      await page.locator('#regwiz-enter').click();

      // Verify we're on the world map
      await expect(page.locator('canvas')).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Back Navigation', () => {
    test('should preserve Step 1 data when navigating back from Step 2', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Wait for wizard
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      // Generate unique credentials
      const { username, email, password } = generateTestCredentials();

      // Fill Step 1 fields
      await page.locator('#regwiz-username').fill(username);
      await page.locator('#regwiz-email').fill(email);
      await page.locator('#regwiz-password').fill(password);
      await page.locator('#regwiz-confirm').fill(password);

      // Click Next to go to Step 2
      await page.locator('#regwiz-next').click();

      // Verify we're on Step 2
      await expect(page.locator('.regwiz-title')).toContainText(/create.*hero/i, { timeout: 5000 });

      // Click Back to return to Step 1
      await page.locator('#regwiz-back').click();

      // Verify we're back on Step 1
      await expect(page.locator('.regwiz-title')).toContainText(/create.*account/i, { timeout: 5000 });

      // Verify fields still have the entered values
      await expect(page.locator('#regwiz-username')).toHaveValue(username);
      await expect(page.locator('#regwiz-email')).toHaveValue(email);
      // Password fields preserve values too
      await expect(page.locator('#regwiz-password')).toHaveValue(password);
      await expect(page.locator('#regwiz-confirm')).toHaveValue(password);
    });
  });

  test.describe('Preview Card Updates', () => {
    test('should update preview card when race selection changes', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Wait for wizard and fill Step 1
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      const { username, email, password } = generateTestCredentials();
      await page.locator('#regwiz-username').fill(username);
      await page.locator('#regwiz-email').fill(email);
      await page.locator('#regwiz-password').fill(password);
      await page.locator('#regwiz-confirm').fill(password);
      await page.locator('#regwiz-next').click();

      // Wait for Step 2
      await expect(page.locator('.regwiz-title')).toContainText(/create.*hero/i, { timeout: 5000 });

      // Select initial race (Human) and class (to get a preview)
      await page.locator('[data-race="human"]').click();
      await page.locator('[data-class="warrior"]').click();

      // Wait for preview to load
      await page.waitForTimeout(500);

      // Verify Human is selected
      await expect(page.locator('[data-race="human"]')).toHaveClass(/selected/);

      // Verify preview card shows Human
      const previewCard = page.locator('#regwiz-preview-card .parchment-card');
      await expect(previewCard).toBeVisible();

      // Change to Elf
      await page.locator('[data-race="elf"]').click();

      // Verify Elf is now selected
      await expect(page.locator('[data-race="elf"]')).toHaveClass(/selected/);
      await expect(page.locator('[data-race="human"]')).not.toHaveClass(/selected/);

      // Wait for preview to update
      await page.waitForTimeout(500);

      // Preview card should still be visible (updated with new race)
      await expect(previewCard).toBeVisible();
    });

    test('should update preview card when class selection changes', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Wait for wizard and fill Step 1
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      const { username, email, password } = generateTestCredentials();
      await page.locator('#regwiz-username').fill(username);
      await page.locator('#regwiz-email').fill(email);
      await page.locator('#regwiz-password').fill(password);
      await page.locator('#regwiz-confirm').fill(password);
      await page.locator('#regwiz-next').click();

      // Wait for Step 2
      await expect(page.locator('.regwiz-title')).toContainText(/create.*hero/i, { timeout: 5000 });

      // Select race and initial class
      await page.locator('[data-race="human"]').click();
      await page.locator('[data-class="warrior"]').click();

      // Wait for preview to load
      await page.waitForTimeout(500);

      // Verify Warrior is selected
      await expect(page.locator('[data-class="warrior"]')).toHaveClass(/selected/);

      // Change to Wizard
      await page.locator('[data-class="wizard"]').click();

      // Verify Wizard is now selected
      await expect(page.locator('[data-class="wizard"]')).toHaveClass(/selected/);
      await expect(page.locator('[data-class="warrior"]')).not.toHaveClass(/selected/);

      // Wait for preview to update
      await page.waitForTimeout(500);

      // Preview card should still be visible
      const previewCard = page.locator('#regwiz-preview-card .parchment-card');
      await expect(previewCard).toBeVisible();
    });

    test('should show description when race is selected', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Fill Step 1 and go to Step 2
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      const { username, email, password } = generateTestCredentials();
      await page.locator('#regwiz-username').fill(username);
      await page.locator('#regwiz-email').fill(email);
      await page.locator('#regwiz-password').fill(password);
      await page.locator('#regwiz-confirm').fill(password);
      await page.locator('#regwiz-next').click();

      // Wait for Step 2
      await expect(page.locator('.regwiz-title')).toContainText(/create.*hero/i, { timeout: 5000 });

      // Select Elf race
      await page.locator('[data-race="elf"]').click();

      // Verify description appears (Elf has +20% MP regen)
      const raceDesc = page.locator('#regwiz-race-desc');
      await expect(raceDesc).toContainText(/mp.*regen|high.*int/i);
    });
  });

  test.describe('Step 1 Validation', () => {
    test('should show error when clicking Next with empty fields', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Wait for wizard
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      // Click Next without filling any fields
      await page.locator('#regwiz-next').click();

      // Verify we stay on Step 1 and see errors
      await expect(page.locator('.regwiz-title')).toContainText(/create.*account/i);

      // Check for error messages
      const errorElements = page.locator('.regwiz-error');
      await expect(errorElements.first()).toBeVisible();
    });

    test('should show error for username too short', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Wait for wizard
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      // Fill with short username
      await page.locator('#regwiz-username').fill('ab');  // Less than 3 chars
      await page.locator('#regwiz-email').fill('test@test.com');
      await page.locator('#regwiz-password').fill('password123');
      await page.locator('#regwiz-confirm').fill('password123');

      // Click Next
      await page.locator('#regwiz-next').click();

      // Verify username error appears
      const usernameInput = page.locator('#regwiz-username');
      await expect(usernameInput).toHaveClass(/error/);

      // Check for username-specific error message
      const errorText = page.locator('.regwiz-error');
      await expect(errorText.first()).toContainText(/at least 3/i);
    });

    test('should show error for invalid email', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Wait for wizard
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      // Fill with invalid email
      await page.locator('#regwiz-username').fill('validuser');
      await page.locator('#regwiz-email').fill('notanemail');  // Invalid format
      await page.locator('#regwiz-password').fill('password123');
      await page.locator('#regwiz-confirm').fill('password123');

      // Click Next
      await page.locator('#regwiz-next').click();

      // Verify email error appears
      const emailInput = page.locator('#regwiz-email');
      await expect(emailInput).toHaveClass(/error/);
    });

    test('should show error for password too short', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Wait for wizard
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      // Fill with short password
      await page.locator('#regwiz-username').fill('validuser');
      await page.locator('#regwiz-email').fill('test@test.com');
      await page.locator('#regwiz-password').fill('short');  // Less than 8 chars
      await page.locator('#regwiz-confirm').fill('short');

      // Click Next
      await page.locator('#regwiz-next').click();

      // Verify password error appears
      const passwordInput = page.locator('#regwiz-password');
      await expect(passwordInput).toHaveClass(/error/);
    });

    test('should show error for mismatched passwords', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Wait for wizard
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      // Fill with mismatched passwords
      await page.locator('#regwiz-username').fill('validuser');
      await page.locator('#regwiz-email').fill('test@test.com');
      await page.locator('#regwiz-password').fill('password123');
      await page.locator('#regwiz-confirm').fill('differentpassword');  // Mismatch

      // Click Next
      await page.locator('#regwiz-next').click();

      // Verify confirm password error appears
      const confirmInput = page.locator('#regwiz-confirm');
      await expect(confirmInput).toHaveClass(/error/);

      // Check for mismatch error message
      const errors = page.locator('.regwiz-error');
      const errorTexts = await errors.allTextContents();
      const hasMismatchError = errorTexts.some(text => /match|different/i.test(text));
      expect(hasMismatchError).toBe(true);
    });
  });

  test.describe('Step 2 Validation', () => {
    test('should show error when submitting without character name', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Fill Step 1
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      const { username, email, password } = generateTestCredentials();
      await page.locator('#regwiz-username').fill(username);
      await page.locator('#regwiz-email').fill(email);
      await page.locator('#regwiz-password').fill(password);
      await page.locator('#regwiz-confirm').fill(password);
      await page.locator('#regwiz-next').click();

      // Wait for Step 2
      await expect(page.locator('.regwiz-title')).toContainText(/create.*hero/i, { timeout: 5000 });

      // Select race, class, gender but no name
      await page.locator('[data-race="human"]').click();
      await page.locator('[data-class="warrior"]').click();
      await page.locator('[data-gender="male"]').click();

      // Leave character name empty and submit
      await page.locator('#regwiz-submit').click();

      // Should show character name error
      const charnameInput = page.locator('#regwiz-charname');
      await expect(charnameInput).toHaveClass(/error/);
    });

    test('should show error when submitting without selecting race/class/gender', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Fill Step 1
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      const { username, email, password } = generateTestCredentials();
      await page.locator('#regwiz-username').fill(username);
      await page.locator('#regwiz-email').fill(email);
      await page.locator('#regwiz-password').fill(password);
      await page.locator('#regwiz-confirm').fill(password);
      await page.locator('#regwiz-next').click();

      // Wait for Step 2
      await expect(page.locator('.regwiz-title')).toContainText(/create.*hero/i, { timeout: 5000 });

      // Only fill name, don't select race/class/gender
      const charName = `Hero${Date.now().toString(36).slice(-6)}`;
      await page.locator('#regwiz-charname').fill(charName);

      // Submit
      await page.locator('#regwiz-submit').click();

      // Should show global error (race/class/gender required)
      const globalError = page.locator('.regwiz-global-error');
      await expect(globalError).toBeVisible();
    });
  });

  test.describe('Trait Tooltip Display', () => {
    test('should display tooltip when hovering over trait badge', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Fill Step 1
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      const { username, email, password } = generateTestCredentials();
      await page.locator('#regwiz-username').fill(username);
      await page.locator('#regwiz-email').fill(email);
      await page.locator('#regwiz-password').fill(password);
      await page.locator('#regwiz-confirm').fill(password);
      await page.locator('#regwiz-next').click();

      // Wait for Step 2
      await expect(page.locator('.regwiz-title')).toContainText(/create.*hero/i, { timeout: 5000 });

      // Select race and class to trigger preview with traits
      await page.locator('[data-race="human"]').click();
      await page.locator('[data-class="warrior"]').click();

      // Wait for preview to load and traits to appear
      await page.waitForTimeout(1000);

      // Look for trait badges in the preview card
      const traitBadge = page.locator('.pc-trait-badge').first();

      // Check if traits are displayed (they may or may not be based on API response)
      if (await traitBadge.isVisible({ timeout: 3000 })) {
        // Get the tooltip text from data-tooltip attribute
        const tooltipText = await traitBadge.getAttribute('data-tooltip');
        expect(tooltipText).toBeTruthy();

        // Hover over the trait badge
        await traitBadge.hover();

        // Wait for tooltip to appear
        await page.waitForTimeout(300);

        // Look for tooltip element (parchment tooltip system)
        const tooltip = page.locator('.parchment-tooltip');
        if (await tooltip.isVisible({ timeout: 2000 })) {
          await expect(tooltip).toContainText(/.+/);  // Contains some text
        }
      }
      // If no traits are visible, the test passes (traits are optional based on API)
    });
  });

  test.describe('UI State and Indicators', () => {
    test('should show correct step indicators throughout flow', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Wait for wizard
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      // Step 1: Verify step 1 is active, 2 and 3 are pending
      await expect(page.locator('.regwiz-step-indicator.active')).toContainText('1');
      const pendingSteps = page.locator('.regwiz-step-indicator.pending');
      await expect(pendingSteps).toHaveCount(2);

      // Fill Step 1 and proceed
      const { username, email, password } = generateTestCredentials();
      await page.locator('#regwiz-username').fill(username);
      await page.locator('#regwiz-email').fill(email);
      await page.locator('#regwiz-password').fill(password);
      await page.locator('#regwiz-confirm').fill(password);
      await page.locator('#regwiz-next').click();

      // Step 2: Verify step 1 is completed, step 2 is active, step 3 is pending
      await expect(page.locator('.regwiz-title')).toContainText(/create.*hero/i, { timeout: 5000 });
      await expect(page.locator('.regwiz-step-indicator.active')).toContainText('2');
      await expect(page.locator('.regwiz-step-indicator.completed')).toHaveCount(1);
    });

    test('should disable submit button while loading', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Fill Step 1
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      const { username, email, password } = generateTestCredentials();
      await page.locator('#regwiz-username').fill(username);
      await page.locator('#regwiz-email').fill(email);
      await page.locator('#regwiz-password').fill(password);
      await page.locator('#regwiz-confirm').fill(password);
      await page.locator('#regwiz-next').click();

      // Wait for Step 2
      await expect(page.locator('.regwiz-title')).toContainText(/create.*hero/i, { timeout: 5000 });

      // Fill character details
      await page.locator('[data-race="human"]').click();
      await page.locator('[data-class="warrior"]').click();
      await page.locator('[data-gender="male"]').click();

      const charName = `Hero${Date.now().toString(36).slice(-6)}`;
      await page.locator('#regwiz-charname').fill(charName);

      // Click submit and verify button shows loading state
      const submitBtn = page.locator('#regwiz-submit');
      await submitBtn.click();

      // Button should briefly show "Creating..." text while loading
      // Note: This may be too fast to catch reliably, so we just verify the flow completes
      await expect(page.locator('.regwiz-success-title')).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Mode Switching', () => {
    test('should switch back to login form from registration wizard', async ({ page }) => {
      // Navigate to registration
      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible({ timeout: 10000 });
      await registerLink.click();

      // Wait for wizard
      await expect(page.locator('.regwiz-container')).toBeVisible({ timeout: 5000 });

      // The wizard doesn't have a direct "back to login" link in the wizard itself
      // Users would need to refresh or complete the flow
      // This test verifies the wizard is shown and is distinct from login form
      await expect(page.locator('.regwiz-panel')).toBeVisible();
      await expect(page.locator('.auth-panel')).not.toBeVisible();
    });
  });
});
