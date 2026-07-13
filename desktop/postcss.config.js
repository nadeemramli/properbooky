// Stop PostCSS config lookup here — without this file, Vite walks up and
// finds the Next.js app's postcss.config.js (tailwind), which isn't a
// dependency of the desktop app.
export default { plugins: {} };
