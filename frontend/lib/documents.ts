import { Document, Packer, Paragraph, TextRun } from "docx";
import { jsPDF } from "jspdf";
import mammoth from "mammoth";
import { degrees, PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type DocumentKind = "pdf" | "docx";
export type PdfPlacement = {
  id: string;
  pageIndex: number;
  kind: "signature" | "logo";
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type PdfPagePreview = { pageIndex: number; image: string };

export async function extractPdfText(file: File): Promise<string> {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const lines = content.items
      .flatMap((item) => ("str" in item ? [item.str.trim()] : []))
      .filter(Boolean);
    pages.push(lines.join(" "));
  }
  return pages.join("\n\n");
}

async function renderPage(pdf: pdfjs.PDFDocumentProxy, pageNumber: number, scaleLimit: number, rotation = 0): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
  const scale = Math.min(scaleLimit, 760 / baseViewport.width);
  const viewport = page.getViewport({ scale, rotation: page.rotate + rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a PDF preview.");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/png");
}

export async function renderPdfPage(file: File, pageIndex: number, rotation = 0): Promise<string> {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  if (pageIndex < 0 || pageIndex >= pdf.numPages) throw new Error("That PDF page is no longer available.");
  return renderPage(pdf, pageIndex + 1, 1.2, rotation);
}

export async function renderPdfThumbnails(file: File): Promise<PdfPagePreview[]> {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const thumbnails: PdfPagePreview[] = [];
  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
    thumbnails.push({
      pageIndex,
      image: await renderPage(pdf, pageIndex + 1, 0.28),
    });
  }
  return thumbnails;
}

export async function countPdfPages(file: File): Promise<number> {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  return pdf.numPages;
}

export async function extractDocxText(file: File): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

export async function makeDocx(text: string): Promise<Blob> {
  const paragraphs = text.split(/\r?\n/).map(
    (line) =>
      new Paragraph({
        children: [new TextRun(line)],
        spacing: { after: 120 },
      }),
  );
  const documentFile = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });
  return Packer.toBlob(documentFile);
}

export function makePdf(text: string): Blob {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 52;
  const lineHeight = 17;
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pdf.internal.pageSize.getWidth() - margin * 2;
  let y = margin;

  for (const paragraph of text.split(/\r?\n/)) {
    const lines = pdf.splitTextToSize(paragraph || " ", maxWidth) as string[];
    for (const line of lines) {
      if (y + lineHeight > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin, y);
      y += lineHeight;
    }
    y += 6;
  }

  return pdf.output("blob");
}

export async function editPdf(
  file: File,
  pageOrder: number[],
  rotations: Record<number, number>,
  placements: PdfPlacement[],
): Promise<Blob> {
  if (!pageOrder.length) throw new Error("A PDF must contain at least one page.");
  const source = await PDFDocument.load(await file.arrayBuffer());
  const pdf = await PDFDocument.create();
  const copiedPages = await pdf.copyPages(source, pageOrder);
  const outputPages = new Map<number, number>();
  for (let index = 0; index < copiedPages.length; index += 1) {
    const originalIndex = pageOrder[index];
    const page = copiedPages[index];
    const currentRotation = page.getRotation().angle;
    page.setRotation(degrees(((currentRotation + (rotations[originalIndex] ?? 0)) % 360 + 360) % 360));
    outputPages.set(originalIndex, index);
    pdf.addPage(page);
  }

  for (const placement of placements) {
    const outputIndex = outputPages.get(placement.pageIndex);
    if (outputIndex === undefined) continue;
    const page = pdf.getPages()[outputIndex];
    if (!page) throw new Error("The selected PDF page could not be found.");
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    const x = placement.x / 100;
    const y = placement.y / 100;
    const width = placement.width / 100;
    const height = placement.height / 100;
    let drawX: number;
    let drawY: number;
    let drawWidth: number;
    let drawHeight: number;
    if (angle === 90) {
      drawX = pageWidth * (1 - y - height);
      drawY = pageHeight * x;
      drawWidth = pageWidth * height;
      drawHeight = pageHeight * width;
    } else if (angle === 180) {
      drawX = pageWidth * (1 - x - width);
      drawY = pageHeight * y;
      drawWidth = pageWidth * width;
      drawHeight = pageHeight * height;
    } else if (angle === 270) {
      drawX = pageWidth * (1 - y - height);
      drawY = pageHeight * (1 - x - width);
      drawWidth = pageWidth * height;
      drawHeight = pageHeight * width;
    } else {
      drawX = pageWidth * x;
      drawY = pageHeight * (1 - y - height);
      drawWidth = pageWidth * width;
      drawHeight = pageHeight * height;
    }
    const imageBytes = await fetch(placement.dataUrl).then((response) => response.arrayBuffer());
    const image = placement.dataUrl.startsWith("data:image/jpeg")
      ? await pdf.embedJpg(imageBytes)
      : await pdf.embedPng(imageBytes);
    page.drawImage(image, {
      x: drawX,
      y: drawY,
      width: drawWidth,
      height: drawHeight,
    });
  }

  const bytes = await pdf.save();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: "application/pdf" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function outputName(filename: string, extension: "pdf" | "docx"): string {
  return `${filename.replace(/\.[^.]+$/, "")}.${extension}`;
}
