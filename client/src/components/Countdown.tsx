import { useEffect, useState } from 'react';

// Обратный отсчёт в секундах. ms — сколько оставалось в момент получения снимка;
// stamp меняется с каждым новым снимком и перезапускает отсчёт.
export function Countdown({ ms, stamp }: { ms: number; stamp: unknown }) {
  const [left, setLeft] = useState(ms);

  useEffect(() => {
    const endsAt = Date.now() + ms;
    setLeft(ms);
    const interval = setInterval(() => setLeft(Math.max(0, endsAt - Date.now())), 250);
    return () => clearInterval(interval);
  }, [ms, stamp]);

  return <span>{Math.ceil(left / 1000)} с</span>;
}
