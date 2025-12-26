import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['engine.test.ts', 'NostrMultiplayer.test.ts', 'multiplayer-sync.test.ts']
  },
});
