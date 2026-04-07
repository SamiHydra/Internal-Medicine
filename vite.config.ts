import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return
          }

          if (id.includes('recharts')) {
            return 'charts'
          }

          if (id.includes('framer-motion')) {
            return 'motion'
          }

          if (id.includes('@supabase')) {
            return 'supabase'
          }

          if (id.includes('@radix-ui')) {
            return 'radix-ui'
          }

          if (
            id.includes('react-router') ||
            id.includes('react-dom') ||
            id.includes('/react/')
          ) {
            return 'react-core'
          }

          return 'vendor'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
