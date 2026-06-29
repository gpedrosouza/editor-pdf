"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { PageData, Edit, TextItem } from "@/lib/api";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const MAX_PDF_WIDTH = 420;

interface Props {
  pdfBase64: string;
  pageData: PageData[];
  selectedItems: Edit[];
  onToggle: (edit: Edit) => void;
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 3.0;

export default function PdfViewer({ pdfBase64, pageData, selectedItems, onToggle }: Props) {
  const [numPages, setNumPages] = useState<number>(pageData.length);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(() => MAX_PDF_WIDTH / (pageData[0]?.width ?? 595));
  const [zoomLevel, setZoomLevel] = useState(1.0);

  const zoomIn    = () => setZoomLevel(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut   = () => setZoomLevel(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  const zoomReset = () => setZoomLevel(1.0);

  // Responsive PDF width: observe the scroll container and fit the page inside it
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Base width fits page in container; zoom multiplies on top of that
  const baseWidth  = containerWidth > 0 ? Math.min(MAX_PDF_WIDTH, containerWidth - 48) : MAX_PDF_WIDTH;
  const pdfPageWidth = Math.round(baseWidth * zoomLevel);

  const onDocumentLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setCurrentPage(1);
  }, []);

  const currentPageData = pageData[currentPage - 1];
  const pdfFile = `data:application/pdf;base64,${pdfBase64}`;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Scroll area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-app-bg"
      >
        {/* Inner wrapper ensures the PDF stays centred when smaller than the
            viewport but allows horizontal scroll when zoomed in. */}
        <div
          style={{
            minWidth: pdfPageWidth + 48,
            display: "flex",
            justifyContent: "center",
            padding: "24px",
          }}
        >
        <Document
          file={pdfFile}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={<PageSkeleton width={pdfPageWidth} />}
          error={<LoadError width={pdfPageWidth} />}
        >
          <div
            className="relative"
            style={{
              width: pdfPageWidth,
              borderRadius: 4,
              boxShadow: "0 4px 32px rgba(0,0,0,0.5)",
              background: "#fff",
              overflow: "hidden",
            }}
          >
            <Page
              pageNumber={currentPage}
              width={pdfPageWidth}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              onRenderSuccess={(page) => {
                setScale(page.width / page.originalWidth);
              }}
            />

            {currentPageData && (
              <TextOverlay
                items={currentPageData.items}
                pageIndex={currentPage - 1}
                pageHeightPt={currentPageData.height}
                scale={scale}
                selectedItems={selectedItems}
                onToggle={onToggle}
              />
            )}
          </div>
        </Document>
        </div>
      </div>

      <PageNav
        current={currentPage}
        total={numPages}
        onChange={setCurrentPage}
        zoomLevel={zoomLevel}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
      />
    </div>
  );
}

// ── TextOverlay ────────────────────────────────────────────────────────────────

interface TextOverlayProps {
  items: TextItem[];
  pageIndex: number;
  pageHeightPt: number;
  scale: number;
  selectedItems: Edit[];
  onToggle: (edit: Edit) => void;
}

function TextOverlay({ items, pageIndex, pageHeightPt, scale, selectedItems, onToggle }: TextOverlayProps) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {items.map((item, idx) => {
        const key = itemKey(pageIndex, item);
        const isSelected = selectedItems.some((e) => editKey(e) === key);

        const cssX = item.x * scale;
        const itemBoxY = item.boxY ?? item.y;
        const itemBoxH = item.boxH ?? item.h;
        const cssY = (pageHeightPt - itemBoxY - itemBoxH) * scale;
        const cssW = item.w * scale;
        const cssH = itemBoxH * scale;

        return (
          <OverlayItem
            key={`${key}-${idx}`}
            cssX={cssX}
            cssY={cssY}
            cssW={cssW}
            cssH={cssH}
            isSelected={isSelected}
            onClick={() => {
              onToggle({
                pageIndex,
                x: item.x,
                y: item.y,
                w: item.w,
                h: item.h,
                boxY: item.boxY,
                boxH: item.boxH,
                fontSize: item.fontSize,
                fontName: item.fontName,
                originalText: item.text,
                newText: item.text,
                textAlign: item.textAlign,
                bgColor: item.bgColor,
                bgRect: item.bgRect,
                underline: item.underline,
              });
            }}
          />
        );
      })}
    </div>
  );
}

// ── OverlayItem ────────────────────────────────────────────────────────────────

interface OverlayItemProps {
  cssX: number;
  cssY: number;
  cssW: number;
  cssH: number;
  isSelected: boolean;
  onClick: () => void;
}

function OverlayItem({ cssX, cssY, cssW, cssH, isSelected, onClick }: OverlayItemProps) {
  const [hovered, setHovered] = useState(false);

  let background = "transparent";
  let border = "none";

  if (isSelected) {
    background = "rgba(99,102,241,0.18)";
    border = "1.5px solid #6366F1";
  } else if (hovered) {
    background = "rgba(99,102,241,0.08)";
    border = "1px dashed #6366F1";
  }

  return (
    <div
      role="button"
      aria-pressed={isSelected}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: cssX,
        top: cssY,
        width: cssW,
        height: cssH,
        background,
        border,
        borderRadius: 2,
        cursor: "pointer",
        pointerEvents: "all",
        transition: "background 0.1s, border 0.1s",
        boxSizing: "border-box",
      }}
    />
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function itemKey(pageIndex: number, item: TextItem): string {
  return `${pageIndex}-${item.x}-${item.y}`;
}

function editKey(edit: Edit): string {
  return `${edit.pageIndex}-${edit.x}-${edit.y}`;
}

// ── PageNav ────────────────────────────────────────────────────────────────────

function PageNav({
  current,
  total,
  onChange,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: {
  current: number;
  total: number;
  onChange: (p: number) => void;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}) {
  const canPrev = current > 1;
  const canNext = current < total;

  const btn: React.CSSProperties = {
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "0.5px solid #2a2d3a",
    borderRadius: 6,
    background: "transparent",
    color: "#9ea3b8",
    cursor: "pointer",
    flexShrink: 0,
  };

  const zoomPct = Math.round(zoomLevel * 100);

  return (
    <div
      style={{
        height: 42,
        borderTop: "0.5px solid #2a2d3a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "#0F1117",
        flexShrink: 0,
        padding: "0 12px",
      }}
    >
      {/* Zoom controls */}
      <button style={btn} onClick={onZoomOut} aria-label="Diminuir zoom" title="Diminuir zoom">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <button
        onClick={onZoomReset}
        title="Restaurar zoom"
        style={{
          minWidth: 44,
          height: 22,
          fontSize: 11,
          color: "#9ea3b8",
          background: "transparent",
          border: "0.5px solid #2a2d3a",
          borderRadius: 4,
          cursor: "pointer",
          userSelect: "none",
          padding: "0 4px",
        }}
      >
        {zoomPct}%
      </button>

      <button style={btn} onClick={onZoomIn} aria-label="Aumentar zoom" title="Aumentar zoom">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {/* Separator */}
      <div style={{ width: 1, height: 20, background: "#2a2d3a", flexShrink: 0, margin: "0 4px" }} />

      {/* Page navigation */}
      <button
        style={{ ...btn, opacity: canPrev ? 1 : 0.35, cursor: canPrev ? "pointer" : "default" }}
        disabled={!canPrev}
        onClick={() => onChange(current - 1)}
        aria-label="Página anterior"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <span style={{ fontSize: 12, color: "#9ea3b8", userSelect: "none", whiteSpace: "nowrap" }}>
        Página {current} de {total}
      </span>

      <button
        style={{ ...btn, opacity: canNext ? 1 : 0.35, cursor: canNext ? "pointer" : "default" }}
        disabled={!canNext}
        onClick={() => onChange(current + 1)}
        aria-label="Próxima página"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}

// ── Skeletons ──────────────────────────────────────────────────────────────────

function PageSkeleton({ width }: { width: number }) {
  return (
    <div
      style={{
        width,
        height: 594,
        borderRadius: 4,
        background: "#1e2130",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#2a2d3a" strokeWidth="2.5" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="#6366F1" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function LoadError({ width }: { width: number }) {
  return (
    <div
      style={{
        width,
        height: 594,
        borderRadius: 4,
        background: "#1e2130",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        color: "#E24B4A",
        fontSize: 13,
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      Erro ao carregar o PDF
    </div>
  );
}
