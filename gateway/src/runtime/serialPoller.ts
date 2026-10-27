export interface SerialPoller { stop(): Promise<void>; }

/** Stop prevents another tick and joins the current one before dependencies close. */
export function startSerialPoller(task: () => Promise<void>, intervalMs: number, onError: (error: unknown) => void): SerialPoller {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void>;
  const tick = () => {
    inFlight = (async () => {
      try { await task(); } catch (error) { onError(error); }
      finally {
        if (!stopped) { timer = setTimeout(tick, intervalMs); timer.unref(); }
      }
    })();
  };
  tick();
  return { async stop() { stopped = true; clearTimeout(timer); await inFlight; } };
}
