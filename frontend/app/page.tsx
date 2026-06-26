"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { ExtractResponse, Edit, editPdf, ApiError } from "@/lib/api";
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

let toastSeq = 0;

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
  const [isApplying, setIsApplying] = useState(false);
  const [editedPdfBase64, setEditedPdfBase64] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Auto-open the mobile drawer when the first item is selected
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (isMobile && selectedItems.length > 0 && prevCountRef.current === 0) {
      setDrawerOpen(true);
    }
    if (selectedItems.length === 0) {
      setDrawerOpen(false);
    }
    prevCountRef.current = selectedItems.length;
  }, [isMobile, selectedItems.length]);

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
    setEditedPdfBase64(null);
    setDrawerOpen(false);
  }

  function handleNewPdf() {
    setLoaded(null);
    setSelectedItems([]);
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

  function handleClearAll() {
    setSelectedItems([]);
  }

  async function handleApply() {
    if (!loaded || isApplying || selectedItems.length === 0) return;
    setIsApplying(true);
    try {
      const resultBase64 = await editPdf(loaded.pdfBase64, selectedItems);
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
    onApply: handleApply,
    isLoading: isApplying,
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
        onDownload={editedPdfBase64 ? handleDownload : undefined}
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
