"use client";

import { useRef, useState, useEffect, DragEvent, ChangeEvent } from "react";
import { extractText, ExtractResponse, ApiError } from "@/lib/api";

interface Props {
  onLoaded: (pdfBase64: string, data: ExtractResponse, filename: string) => void;
}

type ZoneState = "idle" | "dragover" | "loading" | "error";

export default function UploadZone({ onLoaded }: Props) {
  const [state, setState] = useState<ZoneState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Prevent the browser from opening the dropped file as a new page.
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener("dragover", prevent);
    document.addEventListener("drop", prevent);
    return () => {
      document.removeEventListener("dragover", prevent);
      document.removeEventListener("drop", prevent);
    };
  }, []);

  async function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setErrorMsg("Apenas arquivos PDF são aceitos.");
      setState("error");
      return;
    }

    setState("loading");
    setErrorMsg("");

    try {
      const base64 = await readAsBase64(file);
      const data = await extractText(base64);
      onLoaded(base64, data, file.name);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setErrorMsg("PDF escaneado ou sem texto selecionável. Envie um PDF com texto nativo.");
      } else if (err instanceof TypeError) {
        setErrorMsg("Não foi possível conectar ao servidor. Verifique se o backend está rodando.");
      } else {
        setErrorMsg("Erro ao processar o PDF. Tente novamente.");
      }
      setState("error");
    }
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    setState("dragover");
  }

  function onDragLeave(e: DragEvent) {
    // Only reset when the cursor truly leaves the upload zone, not when
    // it moves over a child element inside it.
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setState("idle");
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }

  const isDragover = state === "dragover";
  const isLoading = state === "loading";
  const isError = state === "error";

  return (
    <div className="flex-1 flex items-center justify-center p-6 bg-app-bg">
      <div
        role="button"
        tabIndex={0}
        aria-label="Área de upload de PDF"
        onClick={() => !isLoading && inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && !isLoading && inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          border: `1.5px dashed ${isDragover ? "#6366F1" : isError ? "#E24B4A" : "#2a2d3a"}`,
          transition: "border-color 0.15s, background 0.15s",
        }}
        className={[
          "w-full max-w-md rounded-xl p-10 flex flex-col items-center gap-5 cursor-pointer select-none",
          isDragover ? "bg-[rgba(99,102,241,0.06)]" : "bg-elevated",
          isLoading ? "pointer-events-none opacity-70" : "",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={onFileChange}
        />

        {isLoading ? (
          <Spinner />
        ) : (
          <UploadIcon error={isError} dragover={isDragover} />
        )}

        <div className="text-center space-y-1.5">
          <p className="text-primary text-sm font-medium">
            {isLoading
              ? "Processando PDF…"
              : isDragover
              ? "Solte o arquivo aqui"
              : "Arraste um PDF ou clique para selecionar"}
          </p>
          {!isLoading && !isError && (
            <p className="text-faint text-xs">Somente arquivos .pdf são suportados</p>
          )}
          {isError && (
            <p className="text-[#E24B4A] text-xs leading-relaxed max-w-xs">{errorMsg}</p>
          )}
        </div>

        {isError && (
          <button
            onClick={(e) => { e.stopPropagation(); setState("idle"); setErrorMsg(""); }}
            style={{ border: "0.5px solid #2a2d3a" }}
            className="text-muted text-xs px-3 py-1.5 rounded-md hover:bg-[#2a2d3a]/40 transition-colors"
          >
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  );
}

function UploadIcon({ error, dragover }: { error: boolean; dragover: boolean }) {
  const color = error ? "#E24B4A" : dragover ? "#6366F1" : "#2a2d3a";
  return (
    <div
      className="w-14 h-14 rounded-xl flex items-center justify-center transition-colors"
      style={{ background: dragover ? "rgba(99,102,241,0.1)" : "rgba(255,255,255,0.04)" }}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
    </div>
  );
}

function Spinner() {
  return (
    <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: "rgba(99,102,241,0.1)" }}>
      <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#2a2d3a" strokeWidth="2.5"/>
        <path d="M12 2a10 10 0 0 1 10 10" stroke="#6366F1" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:application/pdf;base64," prefix
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
