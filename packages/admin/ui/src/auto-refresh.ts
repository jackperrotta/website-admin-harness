import {useEffect, useRef, useState} from 'react';

/** One in-flight read per visible view, with cancellation, bounded retries and no draft writes. */
export function useAutoRefresh(key: string | null, read: (signal: AbortSignal) => Promise<void>) {
  const latest = useRef(read); latest.current = read;
  const [state, setState] = useState({lastSuccess: 0, error: ''});
  useEffect(() => {
    if (key === null) return;
    let stopped = false, running = false, failures = 0, timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const schedule = () => {clearTimeout(timer); if (!stopped && !document.hidden) timer = setTimeout(run, Math.min(30000 * 2 ** failures, 240000));};
    const run = async () => {
      if (stopped || running || document.hidden || !navigator.onLine) return;
      clearTimeout(timer); running = true; controller = new AbortController();
      try {await latest.current(controller.signal); if (!stopped && !controller.signal.aborted) {failures = 0; setState({lastSuccess: Date.now(), error: ''});}}
      catch (error) {if (!stopped && !controller.signal.aborted) {failures++; setState(before => ({...before, error: error instanceof Error ? error.message : 'Refresh failed'}));}}
      finally {running = false; schedule();}
    };
    const visible = () => {if (document.hidden) {clearTimeout(timer); controller?.abort();} else void run();};
    const wake = () => {void run();};
    document.addEventListener('visibilitychange', visible); window.addEventListener('focus', wake); window.addEventListener('online', wake);
    void run();
    return () => {stopped = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', wake); window.removeEventListener('online', wake);};
  }, [key]);
  return state;
}
