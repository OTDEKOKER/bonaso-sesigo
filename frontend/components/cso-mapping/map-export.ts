/**
 * Client-side export helpers for the CSO Botswana map.
 *
 * All three raster outputs (PNG, PDF, Print) start from the SAME composed canvas
 * — the rendered ECharts map (which already carries the title + "CSO Location"
 * legend) plus a "Generated on <date>" footer — so every export contains the
 * required title, boundaries, points, legend and date, and nothing else (no app
 * chrome, menus or buttons).
 *
 * The PDF is written by a tiny, dependency-free writer that embeds the map as a
 * single JPEG image XObject (DCTDecode) on one landscape page — deliberately no
 * new npm dependency added to the production build.
 */
import type { EChartsType } from "echarts/core";

export const MAP_TITLE = "Map of Civil Society Organisations in Botswana";

/** YYYY-MM-DD in local time, for filenames and the on-image date stamp. */
export function todayStamp(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export const EXPORT_BASENAME = () => `sesigo-cso-locations-botswana-${todayStamp()}`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load map image"));
    img.src = src;
  });
}

/**
 * Rasterise the map and stamp a footer date onto a fresh canvas. Returns the
 * composed canvas (title + legend come from the chart itself).
 */
export async function composeMapCanvas(chart: EChartsType): Promise<HTMLCanvasElement> {
  const pixelRatio = 2;
  const mapUrl = chart.getDataURL({ type: "png", pixelRatio, backgroundColor: "#ffffff" });
  const img = await loadImage(mapUrl);

  const footerH = Math.round(30 * pixelRatio);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height + footerH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  ctx.fillStyle = "#64748b";
  ctx.font = `${13 * pixelRatio}px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(`Generated on ${todayStamp()}`, 12 * pixelRatio, img.height + footerH / 2);
  return canvas;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Build a one-page landscape PDF embedding a JPEG image (no dependencies). */
function buildImagePdf(jpegDataUrl: string, imgW: number, imgH: number): Blob {
  const jpeg = dataUrlToBytes(jpegDataUrl);
  const pageW = 842; // A4 landscape (points)
  const pageH = 595;
  const margin = 28;
  const scale = Math.min((pageW - margin * 2) / imgW, (pageH - margin * 2) / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;

  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const startObj = () => offsets.push(length);

  push("%PDF-1.4\n");
  startObj();
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  startObj();
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  startObj();
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );
  startObj();
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push("\nendstream\nendobj\n");
  const content = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
  startObj();
  push(`5 0 obj\n<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);

  const xrefStart = length;
  const objCount = offsets.length + 1;
  let xref = `xref\n0 ${objCount}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objCount} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

/** Download the composed map as a PNG. */
export async function exportMapPng(chart: EChartsType): Promise<void> {
  const canvas = await composeMapCanvas(chart);
  await new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Could not create the image"));
      triggerDownload(blob, `${EXPORT_BASENAME()}.png`);
      resolve();
    }, "image/png");
  });
}

/** Download the composed map as a one-page landscape PDF. */
export async function exportMapPdf(chart: EChartsType): Promise<void> {
  const canvas = await composeMapCanvas(chart);
  const jpeg = canvas.toDataURL("image/jpeg", 0.92);
  const blob = buildImagePdf(jpeg, canvas.width, canvas.height);
  triggerDownload(blob, `${EXPORT_BASENAME()}.pdf`);
}

/** Open a print-friendly, map-only layout and invoke the browser print dialog. */
export async function printMap(chart: EChartsType): Promise<void> {
  const canvas = await composeMapCanvas(chart);
  const root = document.createElement("div");
  root.id = "cso-map-print-root";
  root.style.display = "none";
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  root.appendChild(canvas);

  const style = document.createElement("style");
  style.media = "print";
  style.textContent = `
    @page { size: landscape; margin: 12mm; }
    @media print {
      body > *:not(#cso-map-print-root) { display: none !important; }
      #cso-map-print-root { display: block !important; }
      #cso-map-print-root canvas { max-width: 100%; height: auto; }
    }
  `;
  document.body.appendChild(root);
  document.head.appendChild(style);

  const cleanup = () => {
    root.remove();
    style.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  // Safety net if afterprint never fires (some browsers).
  setTimeout(cleanup, 2000);
}
