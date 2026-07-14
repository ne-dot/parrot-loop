import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxy = (env.VITE_LOOP_API_PROXY || 'http://127.0.0.1:4010').replace(/\/$/, '')

  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_LOOP_CONSOLE_PORT || 4011) || 4011,
      proxy: {
        '/api': {
          target: apiProxy,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  }
})
