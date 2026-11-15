import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

const API_PORT = process.env.API_PORT ?? '8787';
const rootDir = import.meta.dirname;

/**
 * Копирует статичные файлы расширения в dist-extension:
 * манифест, css и иконки не проходят через бандлер.
 */
function copyExtensionStatics() {
  return {
    name: 'speacher-copy-extension-statics',
    closeBundle() {
      const out = resolve(rootDir, 'dist-extension');
      mkdirSync(out, { recursive: true });
      for (const file of ['manifest.json', 'content.css']) {
        copyFileSync(resolve(rootDir, 'ext', file), resolve(out, file));
      }
      const iconsSrc = resolve(rootDir, 'ext/icons');
      const iconsOut = resolve(out, 'icons');
      mkdirSync(iconsOut, { recursive: true });
      for (const icon of readdirSync(iconsSrc)) {
        copyFileSync(resolve(iconsSrc, icon), resolve(iconsOut, icon));
      }
    },
  };
}

/**
 * Одна команда, два продукта:
 *   npm run build         → dist (веб-версия, для GitHub Pages)
 *   npm run build:ext     → dist-extension (расширение, грузится распакованным)
 *   npm run dev           → дев-сервер веб-версии
 */
export default defineConfig(({ mode }) => {
  if (mode === 'extension') {
    return {
      // Корень сборки — папка расширения, иначе HTML уедут в подкаталог ext/.
      root: resolve(rootDir, 'ext'),
      plugins: [react(), tailwindcss(), copyExtensionStatics()],
      build: {
        outDir: resolve(rootDir, 'dist-extension'),
        emptyOutDir: true,
        sourcemap: false,
        target: 'chrome116',
        rollupOptions: {
          input: {
            popup: resolve(rootDir, 'ext/popup.html'),
            options: resolve(rootDir, 'ext/options.html'),
            offscreen: resolve(rootDir, 'ext/offscreen.html'),
            background: resolve(rootDir, 'ext/src/background.ts'),
            content: resolve(rootDir, 'ext/src/content.ts'),
          },
          output: {
            // Имена без хешей: манифест ссылается на них напрямую.
            entryFileNames: '[name].js',
            chunkFileNames: 'chunks/[name].js',
            assetFileNames: 'assets/[name][extname]',
            // Content script обязан быть одним файлом без import —
            // в MV3 он не является модулем.
            manualChunks: (id) =>
              id.includes('content')
                ? undefined
                : id.includes('node_modules')
                  ? 'vendor'
                  : undefined,
          },
        },
      },
    };
  }

  return {
    // Для GitHub Pages project-сайта: BASE_PATH=/Speacher/
    base: process.env.BASE_PATH ?? '/',
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: true,
      proxy: {
        // Оставлено для тех, кто поднимает локальный сервер (npm start).
        '/api': {
          target: `http://127.0.0.1:${API_PORT}`,
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
