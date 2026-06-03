import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5810,
    proxy: {
      '/api': 'http://localhost:8018',
      '/ws': {
        target: 'ws://localhost:8018',
        ws: true,
      },
    },
  },
})
