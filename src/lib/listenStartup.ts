/**
 * Express 5 passes listen failures (for example EADDRINUSE) as the first
 * argument of the `app.listen` callback. Exit before any background startup
 * so a failed bind does not look like a running server.
 */
export function beginAfterListen(err: unknown, start: () => void): void {
  if (err) {
    console.error("TaskMesh API failed to listen", err);
    process.exit(1);
  } else {
    start();
  }
}
