import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdf.worker')) return 'pdf-worker'
          if (id.includes('node_modules/pdfjs-dist')) return 'pdf-engine'
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts'
          if (id.includes('node_modules/lucide-react')) return 'icons'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react-vendor'
        },
      },
    },
  },
  test: { environment: 'jsdom', setupFiles: './src/test-setup.js', globals: false },
})
