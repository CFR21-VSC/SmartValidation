// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:11294',
    headless: false,          // visible en el browser
    slowMo: 600,              // 600ms entre acciones para que se pueda seguir
    viewport: { width: 1400, height: 900 },
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list'], ['html', { open: 'always' }]],
});
