"use client";

import { useState } from "react";
import { Edit } from "@/lib/api";

interface Props {
  selectedItems: Edit[];
  onRemove: (edit: Edit) => void;
  onChangeNewText: (edit: Edit, newText: string) => void;
  onClearAll: () => void;
  onApply: () => void;
  isLoading?: boolean;
  variant?: "side" | "drawer";
  panelWidth?: number;
  drawerOpen?: boolean;
  onToggleDrawer?: () => void;
}

export default function TextEditPanel({
  selectedItems,
  onRemove,
  onChangeNewText,
  onClearAll,
  onApply,
  isLoading = false,
  variant = "side",
  panelWidth = 300,
  drawerOpen = false,
  onToggleDrawer,
}: Props) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const hasItems = selectedItems.length > 0;
  const applyEnabled = hasItems && !isLoading;

  const sharedBodyProps = { hasItems, selectedItems, onRemove, onChangeNewText };
  const sharedFooterProps = { applyEnabled, hasItems, isLoading, onApply, onClearAll };

  // ── Mobile drawer ────────────────────────────────────────────────────────────
  if (variant === "drawer") {
    return (
      <>
        {drawerOpen && (
          <div
            onClick={onToggleDrawer}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              zIndex: 40,
            }}
          />
        )}

        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "#161920",
            borderTop: "0.5px solid #2a2d3a",
            zIndex: 50,
            maxHeight: "65vh",
            display: "flex",
            flexDirection: "column",
            transform: drawerOpen ? "translateY(0)" : "translateY(calc(100% - 48px))",
            transition: "transform 0.28s cubic-bezier(0.32,0.72,0,1)",
          }}
        >
          {/* Handle bar */}
          <div
            onClick={onToggleDrawer}
            style={{
              height: 48,
              padding: "0 16px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              flexShrink: 0,
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 8,
                left: "50%",
                transform: "translateX(-50%)",
                width: 32,
                height: 4,
                background: "#2a2d3a",
                borderRadius: 2,
              }}
            />
            <EditIcon />
            <span style={{ fontSize: 13, fontWeight: 500, color: "#e2e4ef", flex: 1 }}>
              Edições
            </span>
            {hasItems && (
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
                {selectedItems.length}
              </span>
            )}
            <ChevronIcon up={drawerOpen} />
          </div>

          {/* Content fades in/out with drawer */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              opacity: drawerOpen ? 1 : 0,
              pointerEvents: drawerOpen ? "auto" : "none",
              transition: "opacity 0.15s",
            }}
          >
            <PanelBody {...sharedBodyProps} />
            <PanelFooter {...sharedFooterProps} />
          </div>
        </div>
      </>
    );
  }

  // ── Side panel (tablet / desktop) ────────────────────────────────────────────
  return (
    <aside
      style={{
        width: panelWidth,
        minWidth: panelWidth,
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
          aria-label={`${selectedItems.length} edições pendentes`}
        >
          {selectedItems.length}
        </span>

        {/* Font-substitution warning */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setTooltipOpen((v) => !v)}
            onBlur={() => setTooltipOpen(false)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              display: "flex",
              lineHeight: 0,
            }}
            aria-label="Aviso sobre fontes"
          >
            <WarnIcon />
          </button>
          {tooltipOpen && (
            <div
              style={{
                position: "absolute",
                bottom: "110%",
                right: 0,
                width: 210,
                background: "#1e2130",
                border: "0.5px solid #2a2d3a",
                borderRadius: 6,
                padding: "7px 10px",
                fontSize: 11,
                color: "#9ea3b8",
                lineHeight: "1.5",
                zIndex: 10,
              }}
            >
              Fontes customizadas do PDF serão substituídas por Helvetica/Times no arquivo editado. O layout e posicionamento são preservados.
              <span
                style={{
                  position: "absolute",
                  bottom: -5,
                  right: 6,
                  width: 0,
                  height: 0,
                  borderLeft: "5px solid transparent",
                  borderRight: "5px solid transparent",
                  borderTop: "5px solid #2a2d3a",
                }}
              />
            </div>
          )}
        </div>
      </div>

      <PanelBody {...sharedBodyProps} />
      <PanelFooter {...sharedFooterProps} />
    </aside>
  );
}

// ── PanelBody ──────────────────────────────────────────────────────────────────

interface BodyProps {
  hasItems: boolean;
  selectedItems: Edit[];
  onRemove: (edit: Edit) => void;
  onChangeNewText: (edit: Edit, newText: string) => void;
}

function PanelBody({ hasItems, selectedItems, onRemove, onChangeNewText }: BodyProps) {
  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: hasItems ? 12 : 24,
        display: "flex",
        flexDirection: "column",
        gap: hasItems ? 10 : 0,
        alignItems: hasItems ? "stretch" : "center",
        justifyContent: hasItems ? "flex-start" : "center",
      }}
    >
      {!hasItems ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            textAlign: "center",
          }}
        >
          <CursorTextIcon />
          <p
            style={{
              fontSize: 13,
              color: "#4a4e63",
              lineHeight: "1.5",
              maxWidth: 180,
              margin: 0,
            }}
          >
            Clique em qualquer texto do PDF para editá-lo
          </p>
        </div>
      ) : (
        selectedItems.map((edit) => (
          <EditCard
            key={`${edit.pageIndex}-${edit.x}-${edit.y}`}
            edit={edit}
            onRemove={() => onRemove(edit)}
            onChangeNewText={(text) => onChangeNewText(edit, text)}
          />
        ))
      )}
    </div>
  );
}

// ── PanelFooter ────────────────────────────────────────────────────────────────

interface FooterProps {
  applyEnabled: boolean;
  hasItems: boolean;
  isLoading: boolean;
  onApply: () => void;
  onClearAll: () => void;
}

function PanelFooter({ applyEnabled, hasItems, isLoading, onApply, onClearAll }: FooterProps) {
  return (
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
        onClick={applyEnabled ? onApply : undefined}
        disabled={!applyEnabled}
        style={{
          background: "#6366F1",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          padding: 10,
          fontSize: 13,
          fontWeight: 500,
          width: "100%",
          cursor: applyEnabled ? "pointer" : "not-allowed",
          opacity: applyEnabled ? 1 : 0.45,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          transition: "opacity 0.15s",
        }}
      >
        {isLoading ? <SpinnerIcon /> : <CheckIcon />}
        {isLoading ? "Processando…" : "Aplicar edições"}
      </button>

      <button
        onClick={hasItems && !isLoading ? onClearAll : undefined}
        disabled={!hasItems || isLoading}
        style={{
          background: "transparent",
          color: "#9ea3b8",
          border: "0.5px solid #2a2d3a",
          borderRadius: 8,
          padding: 10,
          fontSize: 12,
          width: "100%",
          cursor: hasItems && !isLoading ? "pointer" : "not-allowed",
          opacity: hasItems && !isLoading ? 1 : 0.45,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          transition: "opacity 0.15s",
        }}
      >
        <RefreshIcon />
        Limpar seleção
      </button>
    </div>
  );
}

// ── EditCard ───────────────────────────────────────────────────────────────────

function EditCard({
  edit,
  onRemove,
  onChangeNewText,
}: {
  edit: Edit;
  onRemove: () => void;
  onChangeNewText: (text: string) => void;
}) {
  return (
    <div
      style={{
        background: "#1e2130",
        border: "0.5px solid #2a2d3a",
        borderRadius: 8,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            background: "#6366F1",
            color: "#fff",
            fontSize: 9,
            fontWeight: 600,
            borderRadius: 4,
            padding: "2px 5px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Pág. {edit.pageIndex + 1}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "#9ea3b8",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {edit.originalText}
        </span>
        <button
          onClick={onRemove}
          style={{
            background: "none",
            border: "none",
            padding: "2px 4px",
            cursor: "pointer",
            color: "#4a4e63",
            lineHeight: 0,
            flexShrink: 0,
          }}
          aria-label="Remover edição"
        >
          <XIcon />
        </button>
      </div>

      <div
        style={{
          background: "#13151f",
          border: "0.5px solid #2a2d3a",
          borderRadius: 5,
          padding: "5px 8px",
          fontSize: 11,
          color: "#6e7391",
          fontFamily: "monospace",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={edit.originalText}
      >
        {edit.originalText}
      </div>

      <div style={{ display: "flex", justifyContent: "center", lineHeight: 0 }}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6366F1"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <polyline points="19 12 12 19 5 12" />
        </svg>
      </div>

      <input
        type="text"
        value={edit.newText}
        onChange={(e) => onChangeNewText(e.target.value)}
        placeholder="Novo valor…"
        style={{
          background: "#13151f",
          border: "1px solid #6366F1",
          borderRadius: 5,
          padding: "5px 8px",
          fontSize: 11,
          color: "#e2e4ef",
          fontFamily: "monospace",
          width: "100%",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function EditIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#9ea3b8"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#EF9F27"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#6e7391"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: up ? "rotate(180deg)" : "none", transition: "transform 0.22s" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CursorTextIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#2a2d3a"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3c-1.2 5.4-1.2 12.6 0 18" />
      <path d="M8 5c-1.5.5-3.5 1.5-5 3l5 1" />
      <path d="M16 5c1.5.5 3.5 1.5 5 3l-5 1" />
      <path d="M8 19c-1.5-.5-3.5-1.5-5-3l5-1" />
      <path d="M16 19c1.5-.5 3.5-1.5 5-3l-5-1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
