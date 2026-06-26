"use client";

import { useState, useEffect } from "react";

export function useWindowWidth(): number {
  const [width, setWidth] = useState(1280); // SSR-safe default keeps side panel on first paint

  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  return width;
}
