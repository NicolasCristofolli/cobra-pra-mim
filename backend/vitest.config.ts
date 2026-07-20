import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // Os testes de integração compartilham o mesmo banco: execução sequencial
    // evita corrida entre TRUNCATEs de arquivos diferentes.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000
  }
});
