import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Куда dev-сервер проксирует API. В контейнере ту же роль играет nginx,
 * поэтому прод-сборка сюда не заглядывает. Адрес фиксирован: @types/node
 * в проекте нет, и читать process.env отсюда нечем.
 */
const BACKEND_TARGET = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Тот же контракт, что и у nginx в контейнере: API живёт на origin фронта.
    // Без этого dev и прод расходились бы, и относительные пути работали
    // бы только в Docker.
    proxy: {
      '/api': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/socket.io': { target: BACKEND_TARGET, ws: true },
    },
  },
});
