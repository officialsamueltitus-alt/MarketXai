// The server bundle lives in server-dist/ (never publicly served). This shim keeps an older
// start command (`node dist/start.cjs`) working; the static server refuses to serve .cjs files.
import fs from 'node:fs';
fs.rmSync('dist/server.cjs', { force: true });
fs.rmSync('dist/server.cjs.map', { force: true });
fs.writeFileSync('dist/start.cjs', "require('../server-dist/start.cjs');\n");
