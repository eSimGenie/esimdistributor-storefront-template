import { defineConfig } from 'vitest/config';

// Plain Vitest config (not Astro's getViteConfig): the tested modules in src/lib are framework-free.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
