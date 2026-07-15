export interface ReadImageResult {
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

export function readImageFile(file: File): Promise<ReadImageResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new window.Image();
      img.onload = () => resolve({ dataUrl, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
      img.onerror = () => reject(new Error("Não foi possível ler a imagem"));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo"));
    reader.readAsDataURL(file);
  });
}

// Sizes a new image relative to the page (not 1:1 with its pixel dimensions —
// a multi-megapixel photo shouldn't become thousands of PDF points wide),
// preserving its own aspect ratio, centered on the page.
export function defaultImageBox(
  naturalWidth: number,
  naturalHeight: number,
  pageWidthPt: number,
  pageHeightPt: number
): { x: number; y: number; w: number; h: number } {
  const aspect = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 1;
  const MAX_FRACTION = 0.35;
  const MAX_WIDTH_PT = 240;

  let w = Math.min(pageWidthPt * MAX_FRACTION, MAX_WIDTH_PT);
  let h = w / aspect;
  if (h > pageHeightPt * MAX_FRACTION) {
    h = pageHeightPt * MAX_FRACTION;
    w = h * aspect;
  }

  return { x: (pageWidthPt - w) / 2, y: (pageHeightPt - h) / 2, w, h };
}
