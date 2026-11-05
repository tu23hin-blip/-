'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** url を intervalMs ごとに取得する（既定10秒）。タブが非表示の間は止める */
export function usePoll(url, intervalMs = 10000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const load = useCallback(async () => {
    try {
      const res = await fetch(urlRef.current, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      setData(json); setError(null); setUpdatedAt(new Date());
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, intervalMs);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [url, intervalMs, load]);

  return { data, error, updatedAt, reload: load };
}

/** 1秒ごとに再描画（経過時間の表示用） */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // http://(LANのIP) などで clipboard API が使えないとき
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const okCopy = document.execCommand('copy');
    document.body.removeChild(ta);
    return okCopy;
  }
}
