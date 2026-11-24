// Diagnostic wrapper to get the full stack trace from updateVoterNames.js
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT:', err.message);
  console.error(err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason?.message ?? reason);
  if (reason?.stack) console.error(reason.stack);
  process.exit(1);
});

import("./src/scripts/updateVoterNames.js").catch((err) => {
  console.error("IMPORT ERROR:", err.message);
  console.error(err.stack);
  process.exit(1);
});
