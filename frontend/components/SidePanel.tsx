"use client";

// Phase 3: side panel with empty state.
// Phases 4-5 will wire up selectedItems, callbacks, and the apply button.

export default function SidePanel() {
  return (
    <aside
      style={{
        width: 300,
        minWidth: 300,
        background: "#161920",
        borderLeft: "0.5px solid #2a2d3a",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "0.5px solid #2a2d3a",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <EditIcon />
        <span style={{ fontSize: 13, fontWeight: 500, color: "#e2e4ef", flex: 1 }}>
          Edições
        </span>
        <span
          style={{
            background: "#6366F1",
            color: "#fff",
            borderRadius: 10,
            padding: "1px 7px",
            fontSize: 10,
            fontWeight: 500,
            lineHeight: "16px",
          }}
        >
          0
        </span>
        <WarnIcon />
      </div>

      {/* Body — empty state */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: 24,
          textAlign: "center",
        }}
      >
        <CursorTextIcon />
        <p style={{ fontSize: 13, color: "#4a4e63", lineHeight: "1.5", maxWidth: 180 }}>
          Clique em qualquer texto do PDF para editá-lo
        </p>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "0.5px solid #2a2d3a",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <button
          disabled
          style={{
            background: "#6366F1",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: 10,
            fontSize: 13,
            fontWeight: 500,
            width: "100%",
            cursor: "not-allowed",
            opacity: 0.45,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <CheckIcon />
          Aplicar edições
        </button>
        <button
          disabled
          style={{
            background: "transparent",
            color: "#9ea3b8",
            border: "0.5px solid #2a2d3a",
            borderRadius: 8,
            padding: 10,
            fontSize: 12,
            width: "100%",
            cursor: "not-allowed",
            opacity: 0.45,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <RefreshIcon />
          Limpar seleção
        </button>
      </div>
    </aside>
  );
}

// ── Inline icons ───────────────────────────────────────────────────────────────

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ea3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#EF9F27" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: "pointer" }}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}

function CursorTextIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2a2d3a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c-1.2 5.4-1.2 12.6 0 18"/>
      <path d="M8 5c-1.5.5-3.5 1.5-5 3l5 1"/>
      <path d="M16 5c1.5.5 3.5 1.5 5 3l-5 1"/>
      <path d="M8 19c-1.5-.5-3.5-1.5-5-3l5-1"/>
      <path d="M16 19c1.5-.5 3.5-1.5 5-3l-5-1"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}
