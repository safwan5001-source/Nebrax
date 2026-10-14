import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();

// Fail startup when signing inputs are missing/malformed: a deployed service
// must never look healthy while its association files are unusable. Messages
// name the variable, never its value.
if (config.errors.length > 0) {
  for (const message of config.errors) process.stderr.write(`preview-host: configuration error: ${message}\n`);
  process.exit(1);
}

const server = createServer(createApp({ config }));
server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`preview-host: listening on :${server.address().port}\n`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
