// Loaded into the daemon with NODE_OPTIONS=--require by the soak harness. When the file named by
// SOAK_HANG_FLAG appears, the event loop is blocked for good with the port still bound: the failure
// mode of the real outages. Works on Windows too, unlike SIGSTOP.
const fs = require('node:fs');
const flag = process.env.SOAK_HANG_FLAG;
if (flag) {
  const t = setInterval(() => {
    if (fs.existsSync(flag)) {
      fs.unlinkSync(flag);
      for (;;) { /* hang */ }
    }
  }, 200);
  t.unref();
}
