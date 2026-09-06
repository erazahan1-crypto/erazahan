// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig(async ({ mode }) => {
  const integrations = [react()];
  if (mode === 'development') {
    const { default: keystatic } = await import('@keystatic/astro');
    integrations.push(keystatic());
  }

  return {
  site: 'https://erazahan.info',

  vite: {
    plugins: [tailwindcss()],
  },

    // The CMS needs a local writable filesystem, so it is never included in Pages builds.
    integrations,
  };
});