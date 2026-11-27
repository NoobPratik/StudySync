"use client";

import { useEffect, useState } from "react";

export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) return;
    let count = 0;
    const resetId = setTimeout(() => setSeconds(0), 0);
    const interval = setInterval(() => {
      count += 1;
      setSeconds(count);
    }, 1000);
    return () => {
      clearTimeout(resetId);
      clearInterval(interval);
    };
  }, [active]);

  return active ? seconds : 0;
}
