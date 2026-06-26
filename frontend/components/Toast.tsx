"use client";

import { useEffect, useRef } from "react";

export type ToastType = "success" | "error" | "info";

export interface ToastMsg {
  id: number;
  message: string;
  type: ToastType;
}

const BORDER: Record<ToastType, string> = {
  success: "#1D9E75",
  error: "#E24B4A",
  info: "#378ADD",
};

function ToastItem({ msg, onDismiss }: { msg: ToastMsg; onDismiss: () => void }) {
  // Keep a ref so the timer always calls the latest onDismiss without restarting
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(), 4000);
    return () => clearTimeout(t);
  }, []); // timer fires once per mount — intentional

  return (
    <div
      className="toast-slide-in"
      style={{
        background: "#1e2130",
        borderRadius: 8,
        padding: "12px 16px",
        minWidth: 260,
        maxWidth: 360,
        borderLeft: `3px solid ${BORDER[msg.type]}`,
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
      }}
    >
      <ToastIcon type={msg.type} />
      <span style={{ fontSize: 13, color: "#e2e4ef", flex: 1, lineHeight: "1.4" }}>
        {msg.message}
      </span>
      <button
        onClick={onDismiss}
        aria-label="Fechar"
        style={{
          background: "none",
          border: "none",
          color: "#6e7391",
          cursor: "pointer",
          padding: "0 2px",
          fontSize: 16,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastMsg[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "auto",
      }}
    >
      {toasts.map((msg) => (
        <ToastItem key={msg.id} msg={msg} onDismiss={() => onDismiss(msg.id)} />
      ))}
    </div>
  );
}

function ToastIcon({ type }: { type: ToastType }) {
  if (type === "success") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    );
  }
  if (type === "error") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E24B4A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#378ADD" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
      <line x1="12" y1="12" x2="12" y2="16"/>
    </svg>
  );
}
