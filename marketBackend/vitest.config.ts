import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage'
    }
  },
  resolve: {
    alias: {
      '@config': path.resolve(__dirname, 'src/config'),
      '@controllers': path.resolve(__dirname, 'src/controllers'),
      '@services': path.resolve(__dirname, 'src/services'),
      '@clients': path.resolve(__dirname, 'src/clients'),
      '@infra': path.resolve(__dirname, 'src/infra'),
      '@lib': path.resolve(__dirname, 'src/lib'),
      '@middlewares': path.resolve(__dirname, 'src/middlewares'),
      '@routes': path.resolve(__dirname, 'src/routes'),
      '@types': path.resolve(__dirname, 'src/types')
    }
  }
});
