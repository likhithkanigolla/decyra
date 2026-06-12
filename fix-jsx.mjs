import fs from 'fs';
const file = 'vite.config.ts';
let code = fs.readFileSync(file, 'utf8');
if (!code.includes('esbuild:')) {
  code = code.replace('tanstackStart: {', `esbuild: {\n    jsx: 'automatic',\n    jsxDev: false,\n  },\n  tanstackStart: {`);
  fs.writeFileSync(file, code);
}
