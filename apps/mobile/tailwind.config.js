const { DESIGN_TOKENS } = require('../../packages/config/dist/index.cjs');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: DESIGN_TOKENS.colors.light.background,
        surface: DESIGN_TOKENS.colors.light.surface,
        primary: DESIGN_TOKENS.colors.light.primary,
        foreground: DESIGN_TOKENS.colors.light.foreground,
        muted: DESIGN_TOKENS.colors.light.mutedForeground,
        border: DESIGN_TOKENS.colors.light.border,
      },
    },
  },
  plugins: [],
};
