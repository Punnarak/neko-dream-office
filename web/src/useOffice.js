// Connects to the backend WebSocket (live mode) or the scripted demo feed (?demo=1).
// Reconnects with backoff; no polling — the server pushes on every hook event.

import { useEffect, useReducer, useState } from 'react';
import { initialState, reducer } from './office.js';

const isDemo = new URLSearchParams(location.search).has('demo');

function socketUrl() {
  if (import.meta.env.DEV) return 'ws://127.0.0.1:4777/ws';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export function useOffice() {
  const [state, dispatch] = useReducer(reducer, { ...initialState, mode: isDemo ? 'demo' : 'live' });

  useEffect(() => {
    if (isDemo) {
      let stop = () => {};
      import('./demo.js').then((m) => { stop = m.runDemo(dispatch); });
      return () => stop();
    }

    let ws;
    let retry = 0;
    let timer;
    let closed = false;

    const connect = () => {
      clearTimeout(timer);
      dispatch({ type: 'conn', conn: 'connecting' });
      ws = new WebSocket(socketUrl());
      ws.onopen = () => { retry = 0; };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'snapshot' || msg.type === 'event' || msg.type === 'session' || msg.type === 'redmine' || msg.type === 'tokens' || msg.type === 'holidays' || msg.type === 'claudeTime') dispatch(msg);
      };
      ws.onclose = () => {
        if (closed) return;
        dispatch({ type: 'conn', conn: 'disconnected' });
        const delay = Math.min(15000, 1000 * 2 ** retry++);
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    // Retry straight away when the tab comes back or the network returns.
    const wake = () => {
      if (document.visibilityState === 'visible' && ws && ws.readyState === WebSocket.CLOSED) { retry = 0; connect(); }
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    connect();

    return () => {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      ws?.close();
    };
  }, []);

  return state;
}

// A coarse clock for "x minutes ago" and staleness. Ticks every 30 s, and not at all while hidden.
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let id;
    const start = () => { setNow(Date.now()); clearInterval(id); id = setInterval(() => setNow(Date.now()), intervalMs); };
    const onVis = () => (document.visibilityState === 'visible' ? start() : clearInterval(id));
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [intervalMs]);
  return now;
}

// Ask the backend to re-fetch Redmine issues now. The result arrives over the WebSocket.
export function refreshRedmine() {
  const base = import.meta.env.DEV ? 'http://127.0.0.1:4777' : '';
  return fetch(`${base}/api/redmine/refresh`, { method: 'POST' }).then((r) => r.json()).then((b) => b.ok === true);
}
