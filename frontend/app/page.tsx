"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { ExtractResponse, Edit, EditTransform, PlacedImage, TextAlign, ShapeEdit, ShapeTransform, editPdf, ApiError } from "@/lib/api";
import { exportToExcel, importFromExcel } from "@/lib/excel";
import { readImageFile, defaultImageBox } from "@/lib/image";
import { useWindowWidth } from "@/hooks/useWindowWidth";
import dynamic from "next/dynamic";
import Topbar from "@/components/Topbar";
import UploadZone from "@/components/UploadZone";
const PdfViewer = dynamic(() => import("@/components/PdfViewer"), { ssr: false });
import TextEditPanel from "@/components/TextEditPanel";
import { ToastContainer, ToastMsg } from "@/components/Toast";

interface LoadedState {
  pdfBase64: string;
  filename: string;
  data: ExtractResponse;
}

function editKey(e: Edit) {
  return `${e.pageIndex}-${e.x}-${e.y}`;
}

function shapeEditKey(s: ShapeEdit) {
  return `${s.pageIndex}-${s.x}-${s.y}`;
}

let toastSeq = 0;
let imageSeq = 0;

function downloadPdf(base64: string, filename: string) {
  const byteChars = atob(base64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArray[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([byteArray], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Small delay before revoking so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

export default function Home() {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;
  const panelWidth = windowWidth >= 1024 ? 320 : 280;

  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [selectedItems, setSelectedItems] = useState<Edit[]>([]);
  const [images, setImages] = useState<PlacedImage[]>([]);
  const [selectedShapes, setSelectedShapes] = useState<ShapeEdit[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isApplying, setIsApplying] = useState(false);
  const [editedPdfBase64, setEditedPdfBase64] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Auto-open the mobile drawer when the first item is selected
  const prevCountRef = useRef(0);
  useEffect(() => {
    const activeCount = selectedItems.length + selectedShapes.length;
    if (isMobile && activeCount > 0 && prevCountRef.current === 0) {
      setDrawerOpen(true);
    }
    if (activeCount === 0) {
      setDrawerOpen(false);
    }
    prevCountRef.current = activeCount;
  }, [isMobile, selectedItems.length, selectedShapes.length]);

  const showToast = useCallback((message: string, type: ToastMsg["type"]) => {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  function handleLoaded(pdfBase64: string, data: ExtractResponse, filename: string) {
    setLoaded({ pdfBase64, filename, data });
    setSelectedItems([]);
    setImages([]);
    setSelectedShapes([]);
    setCurrentPage(1);
    setEditedPdfBase64(null);
    setDrawerOpen(false);
  }

  function handleNewPdf() {
    setLoaded(null);
    setSelectedItems([]);
    setImages([]);
    setSelectedShapes([]);
    setCurrentPage(1);
    setEditedPdfBase64(null);
    setDrawerOpen(false);
  }

  function handleToggle(incoming: Edit) {
    setSelectedItems((prev) => {
      const key = editKey(incoming);
      const exists = prev.some((e) => editKey(e) === key);
      return exists
        ? prev.filter((e) => editKey(e) !== key)
        : [...prev, incoming];
    });
  }

  function handleRemove(target: Edit) {
    setSelectedItems((prev) => prev.filter((e) => editKey(e) !== editKey(target)));
  }

  function handleChangeNewText(target: Edit, newText: string) {
    setSelectedItems((prev) =>
      prev.map((e) => (editKey(e) === editKey(target) ? { ...e, newText } : e))
    );
  }

  function handleTransformItem(target: Edit, transform: EditTransform) {
    setSelectedItems((prev) =>
      prev.map((e) => (editKey(e) === editKey(target) ? { ...e, transform } : e))
    );
  }

  function handleClearAll() {
    setSelectedItems([]);
    setSelectedShapes([]);
  }

  function handleToggleShape(incoming: ShapeEdit) {
    setSelectedShapes((prev) => {
      const key = shapeEditKey(incoming);
      const exists = prev.some((s) => shapeEditKey(s) === key);
      return exists
        ? prev.filter((s) => shapeEditKey(s) !== key)
        : [...prev, incoming];
    });
  }

  function handleRemoveShape(target: ShapeEdit) {
    setSelectedShapes((prev) => prev.filter((s) => shapeEditKey(s) !== shapeEditKey(target)));
  }

  function handleTransformShape(target: ShapeEdit, transform: ShapeTransform) {
    setSelectedShapes((prev) =>
      prev.map((s) => (shapeEditKey(s) === shapeEditKey(target) ? { ...s, transform } : s))
    );
  }

  function handleChooseImage() {
    imageInputRef.current?.click();
  }

  async function handleImageFileSelected(file: File) {
    try {
      const { dataUrl, naturalWidth, naturalHeight } = await readImageFile(file);
      const pageData = loaded?.data.pages[currentPage - 1];
      const box = defaultImageBox(naturalWidth, naturalHeight, pageData?.width ?? 595, pageData?.height ?? 842);
      const image: PlacedImage = {
        id: `img-${++imageSeq}`,
        pageIndex: currentPage - 1,
        ...box,
        dataUrl,
      };
      setImages((prev) => [...prev, image]);
    } catch {
      showToast("Não foi possível carregar a imagem.", "error");
    }
  }

  function handleUpdateImageBox(id: string, box: { x: number; y: number; w: number; h: number }) {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, ...box } : img)));
  }

  function handleRemoveImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }

  function handleSetTextAlign(align: TextAlign) {
    setSelectedItems((prev) => prev.map((edit) => ({ ...edit, textAlign: align })));
    setEditedPdfBase64(null);
  }

  function handleExportExcel() {
    if (!loaded) return;

    const count = exportToExcel(loaded.data.pages, loaded.filename);
    showToast(
      count > 0
        ? `Planilha exportada com ${count} valores.`
        : "Nenhum valor editável encontrado para exportar.",
      count > 0 ? "success" : "info"
    );
  }

  function handleChooseExcel() {
    excelInputRef.current?.click();
  }

  async function handleImportExcelFile(file: File) {
    try {
      const edits = await importFromExcel(file);
      if (edits.length === 0) {
        showToast("Nenhum valor novo preenchido na planilha.", "info");
        return;
      }

      setSelectedItems(edits);
      setEditedPdfBase64(null);
      if (isMobile) setDrawerOpen(true);
      showToast(`${edits.length} edições importadas da planilha.`, "success");
    } catch {
      showToast("Não foi possível importar a planilha.", "error");
    }
  }

  async function handleApply() {
    if (
      !loaded ||
      isApplying ||
      (selectedItems.length === 0 && images.length === 0 && selectedShapes.length === 0)
    )
      return;
    setIsApplying(true);
    try {
      const resultBase64 = await editPdf(
        loaded.pdfBase64,
        selectedItems,
        images.map(({ id, ...rest }) => rest),
        selectedShapes
      );
      setEditedPdfBase64(resultBase64);
      const outName = loaded.filename.replace(/\.pdf$/i, "") + "-editado.pdf";
      downloadPdf(resultBase64, outName);
      showToast("PDF editado e baixado com sucesso!", "success");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 422) {
          showToast("PDF escaneado não suportado", "error");
        } else {
          showToast("Erro ao processar o PDF. Tente novamente.", "error");
        }
      } else {
        showToast("Erro de conexão com o servidor", "error");
      }
    } finally {
      setIsApplying(false);
    }
  }

  function handleDownload() {
    if (!editedPdfBase64 || !loaded) return;
    const outName = loaded.filename.replace(/\.pdf$/i, "") + "-editado.pdf";
    downloadPdf(editedPdfBase64, outName);
  }

  const panelProps = {
    selectedItems,
    onRemove: handleRemove,
    onChangeNewText: handleChangeNewText,
    onClearAll: handleClearAll,
    onSetTextAlign: handleSetTextAlign,
    onApply: handleApply,
    isLoading: isApplying,
    images,
    onAddImageClick: handleChooseImage,
    onRemoveImage: handleRemoveImage,
    selectedShapes,
    onRemoveShape: handleRemoveShape,
  };

  if (!loaded) {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <Topbar />
        <UploadZone onLoaded={handleLoaded} />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0F1117",
      }}
    >
      <Topbar
        filename={loaded.filename}
        showActions
        onNewPdf={handleNewPdf}
        onExportExcel={handleExportExcel}
        onImportExcel={handleChooseExcel}
        onDownload={editedPdfBase64 ? handleDownload : undefined}
      />

      <input
        ref={excelInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleImportExcelFile(file);
        }}
      />

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleImageFileSelected(file);
        }}
      />

      <main
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          // On mobile: add bottom padding so content isn't hidden by the drawer handle
          paddingBottom: isMobile ? 48 : 0,
        }}
      >
        <PdfViewer
          pdfBase64={loaded.pdfBase64}
          pageData={loaded.data.pages}
          selectedItems={selectedItems}
          onToggle={handleToggle}
          onTransformItem={handleTransformItem}
          images={images}
          onUpdateImageBox={handleUpdateImageBox}
          onRemoveImage={handleRemoveImage}
          selectedShapes={selectedShapes}
          onToggleShape={handleToggleShape}
          onTransformShape={handleTransformShape}
          onCurrentPageChange={setCurrentPage}
        />

        {!isMobile && (
          <TextEditPanel
            {...panelProps}
            variant="side"
            panelWidth={panelWidth}
          />
        )}
      </main>

      {isMobile && (
        <TextEditPanel
          {...panelProps}
          variant="drawer"
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen((v) => !v)}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
