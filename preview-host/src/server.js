import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();

// Only process-level problems (an unusable PORT) stop the server. Missing or
// malformed platform signing inputs do not: that platform's association route
// answers 503 and nothing resembling an association is emitted. Messages name
// the variable, never its value.
if (config.errors.length > 0) {
  for (const message of config.errors) process.stderr.write(`preview-host: configuration error: ${message}\n`);
  process.exit(1);
}
for (const message of config.notices) process.stderr.write(`preview-host: association disabled (503): ${message}\n`);
process.stdout.write(
  `preview-host: associations android=${config.androidFingerprints ? 'enabled' : 'disabled'} apple=${config.appleTeamId ? 'enabled' : 'disabled'}\n`,
);

const server = createServer(createApp({ config }));
server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`preview-host: listening on :${server.address().port}\n`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
