import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // ethers v6 alone is about 500 kB minified, so the default 500 kB warning would always fire.
    chunkSizeWarningLimit: 900,
  },
})
