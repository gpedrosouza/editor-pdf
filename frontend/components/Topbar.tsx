"use client";

interface Props {
  filename?: string;
  onNewPdf?: () => void;
  onDownload?: () => void;
  showActions?: boolean;
}

export default function Topbar({ filename, onNewPdf, onDownload, showActions = false }: Props) {
  return (
    <header
      style={{
        height: 52,
        background: "#161920",
        borderBottom: "0.5px solid #2a2d3a",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 10,
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div
        style={{
          width: 26,
          height: 26,
          background: "#6366F1",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <FileTextIcon />
      </div>

      {/* App name */}
      <span style={{ fontSize: 14, fontWeight: 500, color: "#e2e4ef", marginRight: 4 }}>
        PDF Editor
      </span>

      {/* File badge */}
      {filename && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            background: "#1e2130",
            border: "0.5px solid #2a2d3a",
            borderRadius: 6,
            padding: "4px 10px",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span
            style={{
              fontSize: 12,
              color: "#9ea3b8",
              maxWidth: 220,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {filename}
          </span>
        </div>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Actions — visible only when a PDF is loaded */}
      {showActions && (
        <>
          <button
            onClick={onNewPdf}
            style={{
              background: "transparent",
              border: "0.5px solid #2a2d3a",
              color: "#9ea3b8",
              padding: "6px 12px",
              borderRadius: 6,
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Novo PDF
          </button>

          <button
            onClick={onDownload}
            style={{
              background: "#6366F1",
              border: "none",
              color: "#fff",
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: onDownload ? "pointer" : "not-allowed",
              opacity: onDownload ? 1 : 0.45,
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <DownloadIcon />
            Baixar
          </button>
        </>
      )}
    </header>
  );
}

function FileTextIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}
