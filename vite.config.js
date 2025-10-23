import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // Добавьте эту строку
  build: {
    outDir: 'dist'
  }
})
