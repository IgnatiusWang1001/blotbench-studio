import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
const repoBase = process.env.VITE_BASE_PATH ?? '/'

export default defineConfig({
  base: repoBase,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'BlotBench Studio',
        short_name: 'BlotBench',
        description:
          'Local-first Western Blot, Dot Blot, and gel figure composition with semi-quantification and publication-ready export.',
        theme_color: '#efe6d8',
        background_color: '#efe6d8',
        display: 'standalone',
        scope: repoBase,
        start_url: repoBase,
        icons: [
          {
            src: `${repoBase}favicon.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: `${repoBase}icons.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'blotbench-pages',
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
})
