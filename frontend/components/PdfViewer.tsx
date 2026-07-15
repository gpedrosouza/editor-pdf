"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Rnd } from "react-rnd";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { PageData, Edit, EditTransform, PlacedImage, TextItem, ShapeItem, ShapeEdit, ShapeTransform, BgColor } from "@/lib/api";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const MAX_PDF_WIDTH = 420;

interface Props {
  pdfBase64: string;
  pageData: PageData[];
  selectedItems: Edit[];
  onToggle: (edit: Edit) => void;
  onTransformItem: (edit: Edit, transform: EditTransform) => void;
  images: PlacedImage[];
  onUpdateImageBox: (id: string, box: { x: number; y: number; w: number; h: number }) => void;
  onRemoveImage: (id: string) => void;
  selectedShapes: ShapeEdit[];
  onToggleShape: (shapeEdit: ShapeEdit) => void;
  onTransformShape: (shapeEdit: ShapeEdit, transform: ShapeTransform) => void;
  onCurrentPageChange?: (page: number) => void;
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 3.0;

export default function PdfViewer({
  pdfBase64,
  pageData,
  selectedItems,
  onToggle,
  onTransformItem,
  images,
  onUpdateImageBox,
  onRemoveImage,
  selectedShapes,
  onToggleShape,
  onTransformShape,
  onCurrentPageChange,
}: Props) {
  const [numPages, setNumPages] = useState<number>(pageData.length);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(() => MAX_PDF_WIDTH / (pageData[0]?.width ?? 595));
  const [zoomLevel, setZoomLevel] = useState(1.0);

  useEffect(() => {
    onCurrentPageChange?.(currentPage);
  }, [currentPage, onCurrentPageChange]);

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
                onTransformItem={onTransformItem}
              />
            )}

            {currentPageData && (
              <ShapeOverlay
                shapes={currentPageData.shapes}
                pageIndex={currentPage - 1}
                pageHeightPt={currentPageData.height}
                scale={scale}
                selectedShapes={selectedShapes}
                onToggleShape={onToggleShape}
                onTransformShape={onTransformShape}
              />
            )}

            {currentPageData && (
              <ImageOverlay
                images={images.filter((img) => img.pageIndex === currentPage - 1)}
                pageHeightPt={currentPageData.height}
                scale={scale}
                onUpdateBox={onUpdateImageBox}
                onRemove={onRemoveImage}
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
  onTransformItem: (edit: Edit, transform: EditTransform) => void;
}

function TextOverlay({
  items,
  pageIndex,
  pageHeightPt,
  scale,
  selectedItems,
  onToggle,
  onTransformItem,
}: TextOverlayProps) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {items.map((item, idx) => {
        const key = itemKey(pageIndex, item);
        const edit = buildEditFromItem(pageIndex, item);
        const selectedEdit = selectedItems.find((e) => editKey(e) === key);

        // Selected items become a full drag/resize surface; everything else
        // stays a lightweight click-to-select box (dense pages can have 100+
        // text items — only the ones the user is actively working on get handles).
        if (selectedEdit) {
          return (
            <SelectableTextBox
              key={`${key}-${idx}-${scale.toFixed(4)}`}
              edit={selectedEdit}
              pageHeightPt={pageHeightPt}
              scale={scale}
              onTransform={(transform) => onTransformItem(selectedEdit, transform)}
            />
          );
        }

        const { cssX, cssY, cssW, cssH } = pdfBoxToCss(
          { x: item.x, boxY: item.boxY ?? item.y, w: item.w, boxH: item.boxH ?? item.h },
          pageHeightPt,
          scale
        );

        return (
          <OverlayItem
            key={`${key}-${idx}`}
            cssX={cssX}
            cssY={cssY}
            cssW={cssW}
            cssH={cssH}
            onClick={() => onToggle(edit)}
          />
        );
      })}
    </div>
  );
}

function buildEditFromItem(pageIndex: number, item: TextItem): Edit {
  return {
    pageIndex,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    boxY: item.boxY,
    boxH: item.boxH,
    fontSize: item.fontSize,
    fontName: item.fontName,
    fontFamily: item.fontFamily,
    fontWeight: item.fontWeight,
    originalText: item.text,
    newText: item.text,
    textAlign: item.textAlign,
    bgColor: item.bgColor,
    bgRect: item.bgRect,
    underline: item.underline,
  };
}

// ── OverlayItem ────────────────────────────────────────────────────────────────
// Not-yet-selected text: an invisible hit target, hover-highlighted, click to select.

interface OverlayItemProps {
  cssX: number;
  cssY: number;
  cssW: number;
  cssH: number;
  onClick: () => void;
}

function OverlayItem({ cssX, cssY, cssW, cssH, onClick }: OverlayItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      role="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: cssX,
        top: cssY,
        width: cssW,
        height: cssH,
        background: hovered ? "rgba(99,102,241,0.08)" : "transparent",
        border: hovered ? "1px dashed #6366F1" : "none",
        borderRadius: 2,
        cursor: "pointer",
        pointerEvents: "all",
        transition: "background 0.1s, border 0.1s",
        boxSizing: "border-box",
      }}
    />
  );
}

// ── SelectableTextBox ────────────────────────────────────────────────────────────
// A selected text item: draggable and resizable. Resize scales fontSize by the
// same ratio the box height changed by; drag only repositions (fontSize untouched).

interface SelectableTextBoxProps {
  edit: Edit;
  pageHeightPt: number;
  scale: number;
  onTransform: (transform: EditTransform) => void;
}

const HANDLE_SIZE = 8;
const HANDLE_STYLE: React.CSSProperties = {
  width: HANDLE_SIZE,
  height: HANDLE_SIZE,
  background: "#6366F1",
  border: "1px solid #fff",
  borderRadius: 2,
};

function SelectableTextBox({ edit, pageHeightPt, scale, onTransform }: SelectableTextBoxProps) {
  const original = {
    x: edit.x,
    boxY: edit.boxY ?? edit.y,
    w: edit.w,
    boxH: edit.boxH ?? edit.h,
    fontSize: edit.fontSize,
  };
  const current = edit.transform ?? original;
  const { cssX, cssY, cssW, cssH } = pdfBoxToCss(current, pageHeightPt, scale);

  return (
    <Rnd
      default={{ x: cssX, y: cssY, width: cssW, height: cssH }}
      bounds="parent"
      resizeHandleStyles={{
        top: HANDLE_STYLE,
        bottom: HANDLE_STYLE,
        left: HANDLE_STYLE,
        right: HANDLE_STYLE,
        topLeft: HANDLE_STYLE,
        topRight: HANDLE_STYLE,
        bottomLeft: HANDLE_STYLE,
        bottomRight: HANDLE_STYLE,
      }}
      style={{
        background: "rgba(99,102,241,0.18)",
        border: "1.5px solid #6366F1",
        borderRadius: 2,
        boxSizing: "border-box",
        pointerEvents: "all",
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
      }}
      onDragStop={(_e, data) => {
        const pdfBox = cssBoxToPdf({ x: data.x, y: data.y, width: cssW, height: cssH }, pageHeightPt, scale);
        onTransform({ x: pdfBox.x, boxY: pdfBox.boxY, w: pdfBox.w, boxH: pdfBox.boxH, fontSize: current.fontSize });
      }}
      onResizeStop={(_e, _dir, ref, _delta, position) => {
        const pdfBox = cssBoxToPdf(
          { x: position.x, y: position.y, width: ref.offsetWidth, height: ref.offsetHeight },
          pageHeightPt,
          scale
        );
        // Ratio always derives from the immutable ORIGINAL box height, never
        // from the previous transform — repeated resizes must not compound.
        const fontSize = edit.fontSize * (pdfBox.boxH / original.boxH);
        onTransform({ x: pdfBox.x, boxY: pdfBox.boxY, w: pdfBox.w, boxH: pdfBox.boxH, fontSize });
      }}
    >
      <span
        style={{
          fontSize: Math.max(current.fontSize * scale, 6),
          fontFamily: cssFontFamily(edit.fontFamily, edit.fontName),
          fontWeight: edit.fontWeight === "bold" ? 700 : 400,
          color: "#1a1a2e",
          width: "100%",
          textAlign: edit.textAlign === "right" ? "right" : "left",
          whiteSpace: "nowrap",
          overflow: "hidden",
          padding: "0 2px",
        }}
      >
        {edit.newText}
      </span>
    </Rnd>
  );
}

function cssFontFamily(fontFamily?: string, fontName?: string): string {
  const family = (fontFamily || fontName || "").toLowerCase();
  if (family.includes("courier") || family.includes("mono")) return "monospace";
  if (family.includes("times") || (family.includes("serif") && !family.includes("sans"))) return "serif";
  return "sans-serif";
}

// ── ImageOverlay ────────────────────────────────────────────────────────────────
// User-inserted images: always draggable/resizable as soon as they're placed
// (unlike text, they don't start inert — there's nothing to "select" first).

interface ImageOverlayProps {
  images: PlacedImage[];
  pageHeightPt: number;
  scale: number;
  onUpdateBox: (id: string, box: { x: number; y: number; w: number; h: number }) => void;
  onRemove: (id: string) => void;
}

function ImageOverlay({ images, pageHeightPt, scale, onUpdateBox, onRemove }: ImageOverlayProps) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {images.map((image) => (
        <ImageBox
          key={`${image.id}-${scale.toFixed(4)}`}
          image={image}
          pageHeightPt={pageHeightPt}
          scale={scale}
          onUpdateBox={onUpdateBox}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function ImageBox({
  image,
  pageHeightPt,
  scale,
  onUpdateBox,
  onRemove,
}: {
  image: PlacedImage;
  pageHeightPt: number;
  scale: number;
  onUpdateBox: (id: string, box: { x: number; y: number; w: number; h: number }) => void;
  onRemove: (id: string) => void;
}) {
  const { cssX, cssY, cssW, cssH } = pdfBoxToCss(
    { x: image.x, boxY: image.y, w: image.w, boxH: image.h },
    pageHeightPt,
    scale
  );

  return (
    <Rnd
      default={{ x: cssX, y: cssY, width: cssW, height: cssH }}
      bounds="parent"
      lockAspectRatio
      resizeHandleStyles={{
        bottomRight: HANDLE_STYLE,
        bottomLeft: HANDLE_STYLE,
        topRight: HANDLE_STYLE,
        topLeft: HANDLE_STYLE,
      }}
      style={{ pointerEvents: "all", border: "1.5px dashed #6366F1", boxSizing: "border-box" }}
      onDragStop={(_e, data) => {
        const pdfBox = cssBoxToPdf({ x: data.x, y: data.y, width: cssW, height: cssH }, pageHeightPt, scale);
        onUpdateBox(image.id, { x: pdfBox.x, y: pdfBox.boxY, w: pdfBox.w, h: pdfBox.boxH });
      }}
      onResizeStop={(_e, _dir, ref, _delta, position) => {
        const pdfBox = cssBoxToPdf(
          { x: position.x, y: position.y, width: ref.offsetWidth, height: ref.offsetHeight },
          pageHeightPt,
          scale
        );
        onUpdateBox(image.id, { x: pdfBox.x, y: pdfBox.boxY, w: pdfBox.w, h: pdfBox.boxH });
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.dataUrl}
        alt=""
        draggable={false}
        style={{ width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none", display: "block" }}
      />
      <button
        onClick={() => onRemove(image.id)}
        aria-label="Remover imagem"
        style={{
          position: "absolute",
          top: -8,
          right: -8,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#E24B4A",
          color: "#fff",
          border: "1.5px solid #fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          lineHeight: 0,
        }}
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </Rnd>
  );
}

// ── ShapeOverlay ───────────────────────────────────────────────────────────────
// Standalone vector shapes (bars/rules): follows TEXT's select-first model,
// not images' always-active one — a page can have several structural rules
// (table borders, row separators) the user shouldn't be able to drag by accident.

interface ShapeOverlayProps {
  shapes: ShapeItem[];
  pageIndex: number;
  pageHeightPt: number;
  scale: number;
  selectedShapes: ShapeEdit[];
  onToggleShape: (shapeEdit: ShapeEdit) => void;
  onTransformShape: (shapeEdit: ShapeEdit, transform: ShapeTransform) => void;
}

function ShapeOverlay({
  shapes,
  pageIndex,
  pageHeightPt,
  scale,
  selectedShapes,
  onToggleShape,
  onTransformShape,
}: ShapeOverlayProps) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {shapes.map((shape, idx) => {
        const key = shapeKey(pageIndex, shape);
        const shapeEdit = buildShapeEditFromItem(pageIndex, shape);
        const selected = selectedShapes.find((s) => shapeEditKey(s) === key);

        if (selected) {
          return (
            <SelectableShapeBox
              key={`${key}-${idx}-${scale.toFixed(4)}`}
              shapeEdit={selected}
              pageHeightPt={pageHeightPt}
              scale={scale}
              onTransform={(transform) => onTransformShape(selected, transform)}
            />
          );
        }

        const { cssX, cssY, cssW, cssH } = pdfBoxToCss(
          { x: shape.x, boxY: shape.y, w: shape.w, boxH: shape.h },
          pageHeightPt,
          scale
        );

        return (
          <OverlayItem
            key={`${key}-${idx}`}
            cssX={cssX}
            cssY={cssY}
            cssW={cssW}
            cssH={cssH}
            onClick={() => onToggleShape(shapeEdit)}
          />
        );
      })}
    </div>
  );
}

function buildShapeEditFromItem(pageIndex: number, shape: ShapeItem): ShapeEdit {
  return { pageIndex, x: shape.x, y: shape.y, w: shape.w, h: shape.h, color: shape.color };
}

// ── SelectableShapeBox ───────────────────────────────────────────────────────────
// A selected shape: draggable and resizable, no aspect lock (a rule commonly
// needs independent width/height changes) and no font-scaling math (shapes
// have no font).

function SelectableShapeBox({
  shapeEdit,
  pageHeightPt,
  scale,
  onTransform,
}: {
  shapeEdit: ShapeEdit;
  pageHeightPt: number;
  scale: number;
  onTransform: (transform: ShapeTransform) => void;
}) {
  const current = shapeEdit.transform ?? shapeEdit;
  const { cssX, cssY, cssW, cssH } = pdfBoxToCss(
    { x: current.x, boxY: current.y, w: current.w, boxH: current.h },
    pageHeightPt,
    scale
  );

  return (
    <Rnd
      default={{ x: cssX, y: cssY, width: cssW, height: cssH }}
      bounds="parent"
      resizeHandleStyles={{
        top: HANDLE_STYLE,
        bottom: HANDLE_STYLE,
        left: HANDLE_STYLE,
        right: HANDLE_STYLE,
        topLeft: HANDLE_STYLE,
        topRight: HANDLE_STYLE,
        bottomLeft: HANDLE_STYLE,
        bottomRight: HANDLE_STYLE,
      }}
      style={{
        background: bgColorToCss(shapeEdit.color),
        border: "1.5px solid #6366F1",
        borderRadius: 2,
        boxSizing: "border-box",
        pointerEvents: "all",
      }}
      onDragStop={(_e, data) => {
        const pdfBox = cssBoxToPdf({ x: data.x, y: data.y, width: cssW, height: cssH }, pageHeightPt, scale);
        onTransform({ x: pdfBox.x, y: pdfBox.boxY, w: pdfBox.w, h: pdfBox.boxH });
      }}
      onResizeStop={(_e, _dir, ref, _delta, position) => {
        const pdfBox = cssBoxToPdf(
          { x: position.x, y: position.y, width: ref.offsetWidth, height: ref.offsetHeight },
          pageHeightPt,
          scale
        );
        onTransform({ x: pdfBox.x, y: pdfBox.boxY, w: pdfBox.w, h: pdfBox.boxH });
      }}
    />
  );
}

function bgColorToCss(color: BgColor): string {
  return `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function itemKey(pageIndex: number, item: TextItem): string {
  return `${pageIndex}-${item.x}-${item.y}`;
}

function editKey(edit: Edit): string {
  return `${edit.pageIndex}-${edit.x}-${edit.y}`;
}

function shapeKey(pageIndex: number, shape: ShapeItem): string {
  return `${pageIndex}-${shape.x}-${shape.y}`;
}

function shapeEditKey(shapeEdit: ShapeEdit): string {
  return `${shapeEdit.pageIndex}-${shapeEdit.x}-${shapeEdit.y}`;
}

// Forward: PDF points (bottom-left origin) -> CSS pixels (top-left origin).
function pdfBoxToCss(
  box: { x: number; boxY: number; w: number; boxH: number },
  pageHeightPt: number,
  scale: number
) {
  return {
    cssX: box.x * scale,
    cssY: (pageHeightPt - box.boxY - box.boxH) * scale,
    cssW: box.w * scale,
    cssH: box.boxH * scale,
  };
}

// Inverse of pdfBoxToCss — turns a dragged/resized pixel box back into PDF points.
function cssBoxToPdf(
  cssBox: { x: number; y: number; width: number; height: number },
  pageHeightPt: number,
  scale: number
) {
  return {
    x: cssBox.x / scale,
    boxY: pageHeightPt - cssBox.y / scale - cssBox.height / scale,
    w: cssBox.width / scale,
    boxH: cssBox.height / scale,
  };
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
