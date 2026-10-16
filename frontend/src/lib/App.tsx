import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  downloadBlob,
  editPdf,
  extractDocxText,
  extractPdfText,
  makeDocx,
  makePdf,
  outputName,
  renderPdfPage,
  renderPdfThumbnails,
} from "./lib/documents";
import type { DocumentKind, PdfPagePreview, PdfPlacement } from "./lib/documents";
import { deleteTemplate, loadTemplates, saveTemplate } from "./lib/localStore";
import type { SavedTemplate } from "./lib/localStore";

type Page = "overview" | "workspace" | "templates";
type Toast = { message: string; tone: "success" | "error" | "info" } | null;

const dateToday = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const formatDate = (date: string) => {
  if (!date) return "";
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" }).format(parsed);
};

const readImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The selected image could not be read."));
    };
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });

function App() {
  const [page, setPage] = useState<Page>("overview");
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<DocumentKind | null>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState("");
  const [pageThumbnails, setPageThumbnails] = useState<PdfPagePreview[]>([]);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [pageRotations, setPageRotations] = useState<Record<number, number>>({});
  const [selectedPdfPage, setSelectedPdfPage] = useState(0);
  const [placements, setPlacements] = useState<PdfPlacement[]>([]);
  const [placing, setPlacing] = useState<"signature" | "logo" | null>(null);
  const [signature, setSignature] = useState("");
  const [logo, setLogo] = useState("");
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);
  const [personName, setPersonName] = useState("");
  const [documentDate, setDocumentDate] = useState(dateToday());
  const [templateName, setTemplateName] = useState("");
  const [signatureTemplateName, setSignatureTemplateName] = useState("");
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const signatureInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const signatureCanvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    void loadTemplates()
      .then(setTemplates)
      .catch((error: unknown) => {
        setToast({
          message: error instanceof Error ? error.message : "Saved templates could not be loaded.",
          tone: "error",
        });
      });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const openFile = async (selectedFile: File) => {
    const extension = selectedFile.name.split(".").pop()?.toLowerCase();
    if (extension !== "pdf" && extension !== "docx") {
      setToast({ message: "Choose a PDF or DOCX file. Legacy .doc files are not supported.", tone: "error" });
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      const nextKind: DocumentKind = extension === "pdf" ? "pdf" : "docx";
      const extracted =
        nextKind === "pdf" ? await extractPdfText(selectedFile) : await extractDocxText(selectedFile);
      const thumbnails = nextKind === "pdf" ? await renderPdfThumbnails(selectedFile) : [];
      const firstPage = nextKind === "pdf" ? await renderPdfPage(selectedFile, 0) : "";
      setFile(selectedFile);
      setKind(nextKind);
      setText(extracted);
      setPreview(firstPage);
      setPageThumbnails(thumbnails);
      setPageOrder(thumbnails.map((item) => item.pageIndex));
      setPageRotations({});
      setSelectedPdfPage(0);
      setPlacements([]);
      setPlacing(null);
      setPersonName("");
      setDocumentDate(dateToday());
      setPage("workspace");
      if (nextKind === "pdf" && !extracted.trim()) {
        setToast({
          message: "This PDF has no extractable text. You can still place a signature or logo and export it.",
          tone: "info",
        });
      }
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "The document could not be opened.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) void openFile(selected);
    event.target.value = "";
  };

  const showPdfPage = async (pageIndex: number, rotation = pageRotations[pageIndex] ?? 0) => {
    if (!file || kind !== "pdf") return;
    setSelectedPdfPage(pageIndex);
    try {
      setPreview(await renderPdfPage(file, pageIndex, rotation));
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "The PDF page preview could not be rendered.",
        tone: "error",
      });
    }
  };

  const rotatePdfPage = async () => {
    if (!file) return;
    const nextRotation = ((pageRotations[selectedPdfPage] ?? 0) + 90) % 360;
    setPageRotations((current) => ({ ...current, [selectedPdfPage]: nextRotation }));
    try {
      setPreview(await renderPdfPage(file, selectedPdfPage, nextRotation));
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "The PDF page could not be rotated.",
        tone: "error",
      });
    }
  };

  const movePdfPage = (direction: -1 | 1) => {
    const currentIndex = pageOrder.indexOf(selectedPdfPage);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= pageOrder.length) return;
    setPageOrder((current) => {
      const reordered = [...current];
      [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
      return reordered;
    });
  };

  const removePdfPage = async () => {
    if (pageOrder.length <= 1) {
      setToast({ message: "A PDF must contain at least one page.", tone: "error" });
      return;
    }
    const currentIndex = pageOrder.indexOf(selectedPdfPage);
    const nextOrder = pageOrder.filter((pageIndex) => pageIndex !== selectedPdfPage);
    setPageOrder(nextOrder);
    setPlacements((current) => current.filter((placement) => placement.pageIndex !== selectedPdfPage));
    const nextSelected = nextOrder[Math.min(currentIndex, nextOrder.length - 1)];
    await showPdfPage(nextSelected);
  };

  const saveDocumentTemplate = async () => {
    if (!templateName.trim() || !text.trim()) {
      setToast({ message: "Add a template name and document text before saving.", tone: "error" });
      return;
    }
    const template: SavedTemplate = {
      id: crypto.randomUUID(),
      name: templateName.trim(),
      type: "document",
      content: text,
      createdAt: new Date().toISOString(),
    };
    try {
      const location = await saveTemplate(template);
      setTemplates((current) => [template, ...current]);
      setTemplateName("");
      setToast({
        message: location === "vault" ? "Template saved in the local vault." : "Template saved on this device.",
        tone: "success",
      });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "The template could not be saved.",
        tone: "error",
      });
    }
  };

  const saveSignatureTemplate = async () => {
    if (!signature || !signatureTemplateName.trim()) {
      setToast({ message: "Add a signature and a name before saving its template.", tone: "error" });
      return;
    }
    const template: SavedTemplate = {
      id: crypto.randomUUID(),
      name: signatureTemplateName.trim(),
      type: "signature",
      content: signature,
      createdAt: new Date().toISOString(),
    };
    try {
      const location = await saveTemplate(template);
      setTemplates((current) => [template, ...current]);
      setSignatureTemplateName("");
      setToast({
        message: location === "vault" ? "Signature saved in the local vault." : "Signature saved on this device.",
        tone: "success",
      });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "The signature could not be saved.",
        tone: "error",
      });
    }
  };

  const removeTemplate = async (id: string) => {
    try {
      await deleteTemplate(id);
      setTemplates((current) => current.filter((item) => item.id !== id));
      setToast({ message: "Template deleted from local storage.", tone: "success" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "The template could not be deleted.",
        tone: "error",
      });
    }
  };

  const useDocumentTemplate = (template: SavedTemplate) => {
    setFile(new File([], `${template.name}.docx`, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    setKind("docx");
    setPreview("");
    setPageThumbnails([]);
    setPageOrder([]);
    setPageRotations({});
    setSelectedPdfPage(0);
    setPlacements([]);
    setText(template.content);
    setPersonName("");
    setDocumentDate(dateToday());
    setPage("workspace");
  };

  const applyFields = () => {
    setText((current) =>
      current.replace(/\{\{\s*name\s*\}\}/gi, personName.trim()).replace(/\{\{\s*date\s*\}\}/gi, formatDate(documentDate)),
    );
    setToast({ message: "Name and system date fields applied.", tone: "success" });
  };

  const downloadWord = async () => {
    setBusy(true);
    try {
      downloadBlob(await makeDocx(text), outputName(file?.name ?? "document", "docx"));
      setToast({ message: "Word document created on this device.", tone: "success" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "The Word document could not be created.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      downloadBlob(makePdf(text), outputName(file?.name ?? "document", "pdf"));
      setToast({ message: "PDF created on this device.", tone: "success" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "The PDF could not be created.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const downloadEditedPdf = async () => {
    if (!file || kind !== "pdf") return;
    setBusy(true);
    try {
      const originalText = await extractPdfText(file);
      const changedText = text !== originalText;
      let result: Blob;
      if (changedText) {
        const basePdf = new File([makePdf(text)], outputName(file.name, "pdf"), { type: "application/pdf" });
        result = basePdf;
      } else {
        result = await editPdf(file, pageOrder, pageRotations, placements);
      }
      downloadBlob(result, outputName(file.name, "pdf"));
      setToast({
        message:
          changedText
            ? "Edited text was exported as a reflowed PDF. Original layout, page edits and placements were not retained."
            : placements.length || Object.values(pageRotations).some(Boolean) || pageOrder.some((index, position) => index !== position)
              ? "Your PDF changes were exported on this device."
              : "A copy of the original PDF was exported.",
        tone: "success",
      });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "The edited PDF could not be created.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const attachImage = async (event: ChangeEvent<HTMLInputElement>, imageKind: "signature" | "logo") => {
    const imageFile = event.target.files?.[0];
    event.target.value = "";
    if (!imageFile) return;
    if (!["image/png", "image/jpeg"].includes(imageFile.type)) {
      setToast({ message: "Choose a PNG or JPEG image.", tone: "error" });
      return;
    }
    try {
      const image = await readImage(imageFile);
      if (imageKind === "signature") setSignature(image);
      else setLogo(image);
      setPlacing(imageKind);
      setToast({
        message: file && kind === "pdf" && preview
          ? `Tap the document preview to place your ${imageKind}.`
          : `${imageKind === "signature" ? "Signature" : "Logo"} ready. Open a PDF to place it.`,
        tone: "info",
      });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "The image could not be loaded.",
        tone: "error",
      });
    }
  };

  const placeImage = (event: MouseEvent<HTMLDivElement>) => {
    if (!placing || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(76, ((event.clientX - rect.left) / rect.width) * 100 - 12));
    const y = Math.max(0, Math.min(90, ((event.clientY - rect.top) / rect.height) * 100 - 4));
    const dataUrl = placing === "signature" ? signature : logo;
    if (!dataUrl) return;
    setPlacements((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        kind: placing,
        dataUrl,
        pageIndex: selectedPdfPage,
        x,
        y,
        width: placing === "logo" ? 22 : 24,
        height: placing === "logo" ? 10 : 9,
      },
    ]);
    setPlacing(null);
  };

  const startDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvas.current;
    if (!canvas) return;
    drawing.current = true;
    canvas.setPointerCapture(event.pointerId);
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    context.beginPath();
    context.moveTo(
      ((event.clientX - rect.left) / rect.width) * canvas.width,
      ((event.clientY - rect.top) / rect.height) * canvas.height,
    );
    context.strokeStyle = "#183c35";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
  };

  const continueDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !signatureCanvas.current) return;
    const canvas = signatureCanvas.current;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    context.lineTo(
      ((event.clientX - rect.left) / rect.width) * canvas.width,
      ((event.clientY - rect.top) / rect.height) * canvas.height,
    );
    context.stroke();
  };

  const finishDrawing = () => {
    drawing.current = false;
  };

  const keepSignature = () => {
    const canvas = signatureCanvas.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    let hasInk = false;
    for (let index = 3; index < imageData.data.length; index += 4) {
      if (imageData.data[index] > 0) {
        hasInk = true;
        break;
      }
    }
    if (!hasInk) {
      setToast({ message: "Draw your signature before saving it.", tone: "error" });
      return;
    }
    setSignature(canvas.toDataURL("image/png"));
    setPlacing("signature");
    setShowSignaturePad(false);
    setToast({ message: "Signature ready. Open a PDF to place it.", tone: "info" });
  };

  const clearSignatureCanvas = () => {
    const canvas = signatureCanvas.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
  };

  const applyTemplateToCurrentDoc = (template: SavedTemplate) => {
    if (template.type === "signature") {
      setSignature(template.content);
      setPlacing("signature");
      setPage("workspace");
      setToast({ message: "Signature ready. Open a PDF to place it.", tone: "info" });
      return;
    }
    useDocumentTemplate(template);
  };

  const resetWorkspace = () => {
    setFile(null);
    setKind(null);
    setText("");
    setPreview("");
    setPageThumbnails([]);
    setPageOrder([]);
    setPageRotations({});
    setSelectedPdfPage(0);
    setPlacements([]);
    setPlacing(null);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage("overview"); }}>
          <span className="brand-mark"><Icon name="document" /></span>
          <span><strong>papertrail</strong><small>PRIVATE DOCUMENT STUDIO</small></span>
        </a>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className={page === "overview" ? "nav-link active" : "nav-link"} onClick={() => setPage("overview")}>
            <Icon name="grid" /> Overview
          </button>
          <button className={page === "workspace" ? "nav-link active" : "nav-link"} onClick={() => setPage("workspace")}>
            <Icon name="edit" /> Document studio
          </button>
          <button className={page === "templates" ? "nav-link active" : "nav-link"} onClick={() => setPage("templates")}>
            <Icon name="layers" /> My templates <span className="nav-count">{templates.length}</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <span className="privacy-icon"><Icon name="shield" /></span>
            <strong>Your files stay yours.</strong>
            <p>Documents are processed on this device. Nothing is uploaded to a cloud service.</p>
            <span className="local-indicator"><i /> LOCAL &amp; PRIVATE</span>
          </div>
          <div className="profile">
            <div className="profile-avatar">PT</div>
            <div><strong>Personal workspace</strong><small>Stored on this device</small></div>
            <Icon name="more" />
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{pageTitle(page)}</strong></div>
          <div className="top-actions">
            <span className="offline-status"><i /> Works offline</span>
            <button className="icon-button" aria-label="Install or share app" onClick={() => setToast({ message: "Use your browser menu to install Papertrail on this device.", tone: "info" })}><Icon name="download" /></button>
            <div className="top-avatar">PT</div>
          </div>
        </header>
        {page === "overview" && (
          <Overview
            onNew={() => { resetWorkspace(); setPage("workspace"); }}
            onUpload={() => fileInput.current?.click()}
            onTemplates={() => setPage("templates")}
            templates={templates}
            onUseTemplate={applyTemplateToCurrentDoc}
            busy={busy}
          />
        )}
        {page === "templates" && (
          <TemplatesPage
            templates={templates}
            onUse={applyTemplateToCurrentDoc}
            onDelete={removeTemplate}
            onUpload={() => fileInput.current?.click()}
            onNew={() => { resetWorkspace(); setPage("workspace"); }}
          />
        )}
        {page === "workspace" && (
          <section className="workspace-page">
            <div className="page-heading workspace-heading">
              <div>
                <div className="eyebrow">DOCUMENT STUDIO</div>
                <h1>{file ? file.name : "What are we working on?"}</h1>
                <p>{file ? "Your document is open locally and ready to work on." : "Convert, prepare and sign documents — privately on your device."}</p>
              </div>
              {file && <button className="button button-quiet" onClick={resetWorkspace}><Icon name="plus" /> New document</button>}
            </div>
            {!file ? (
              <div className="studio-grid">
                <div className="upload-card">
                  <div className="upload-illustration"><Icon name="document" /></div>
                  <h2>Start with a document</h2>
                  <p>Open a PDF or Word document from your device. It stays right here.</p>
                  <button className="button button-primary" onClick={() => fileInput.current?.click()} disabled={busy}>
                    <Icon name="upload" /> {busy ? "Opening..." : "Choose a document"}
                  </button>
                  <span className="file-hint">PDF or DOCX · processed on-device</span>
                  <div className="or-divider"><span>OR START WITH A TEMPLATE</span></div>
                  <button className="button button-outline" onClick={() => setPage("templates")}>Browse saved templates <Icon name="arrowRight" /></button>
                </div>
                <div className="studio-side">
                  <div className="mini-card">
                    <span className="mini-icon green"><Icon name="arrows" /></span>
                    <h3>Convert documents</h3>
                    <p>Turn PDFs into editable Word files, or export your Word documents as PDF.</p>
                  </div>
                  <div className="mini-card">
                    <span className="mini-icon sand"><Icon name="pen" /></span>
                    <h3>Sign and brand</h3>
                    <p>Draw or upload your signature, add a company logo and place them on a PDF.</p>
                  </div>
                  <div className="mini-card">
                    <span className="mini-icon blue"><Icon name="layers" /></span>
                    <h3>Reuse your work</h3>
                    <p>Save company documents and signatures as templates whenever you choose.</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="editor-layout">
                <div className="editor-main">
                  <div className="document-toolbar">
                    <div className="doc-type"><span className={kind === "pdf" ? "file-badge pdf" : "file-badge word"}>{kind === "pdf" ? "PDF" : "DOCX"}</span><span>{file.name}</span></div>
                    <span className="local-tag"><i /> LOCAL FILE</span>
                  </div>
                  {kind === "pdf" && preview && (
                    <div className="pdf-canvas-area">
                      <div className="pdf-hint-row">
                        <span><Icon name="info" /> {placing ? `Tap page ${pageOrder.indexOf(selectedPdfPage) + 1} to place your ${placing}.` : "Select a page, then click a tool to add an item"}</span>
                        <span>PAGE {pageOrder.indexOf(selectedPdfPage) + 1} OF {pageOrder.length}</span>
                      </div>
                      <div className="pdf-page-tools">
                        <span>Page {pageOrder.indexOf(selectedPdfPage) + 1} of {pageOrder.length}</span>
                        <div>
                          <button className="page-tool-button" onClick={() => void rotatePdfPage()} title="Rotate page clockwise"><Icon name="rotate" /> Rotate</button>
                          <button className="page-tool-button" onClick={() => movePdfPage(-1)} disabled={pageOrder.indexOf(selectedPdfPage) <= 0} title="Move page earlier"><Icon name="up" /> Earlier</button>
                          <button className="page-tool-button" onClick={() => movePdfPage(1)} disabled={pageOrder.indexOf(selectedPdfPage) >= pageOrder.length - 1} title="Move page later"><Icon name="down" /> Later</button>
                          <button className="page-tool-button danger" onClick={() => void removePdfPage()} disabled={pageOrder.length <= 1} title="Delete page"><Icon name="trash" /> Delete</button>
                        </div>
                      </div>
                      <div
                        className={placing ? "pdf-stage placement-mode" : "pdf-stage"}
                        ref={stageRef}
                        onClick={placeImage}
                        role={placing ? "button" : undefined}
                        aria-label={placing ? `Place ${placing} on PDF` : undefined}
                      >
                        <img className="pdf-page-image" src={preview} alt={`Page ${pageOrder.indexOf(selectedPdfPage) + 1} of the PDF`} />
                        {placements.filter((placement) => placement.pageIndex === selectedPdfPage).map((placement) => (
                          <div
                            className="placement-item"
                            key={placement.id}
                            style={{ left: `${placement.x}%`, top: `${placement.y}%`, width: `${placement.width}%`, height: `${placement.height}%` }}
                          >
                            <img src={placement.dataUrl} alt={placement.kind} />
                            <button
                              className="placement-remove"
                              aria-label={`Remove ${placement.kind}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setPlacements((current) => current.filter((item) => item.id !== placement.id));
                              }}
                            >×</button>
                          </div>
                        ))}
                      </div>
                      {pageOrder.length > 1 && (
                        <div className="pdf-thumbnail-strip" aria-label="PDF pages">
                          {pageOrder.map((pageIndex, position) => {
                            const thumbnail = pageThumbnails.find((item) => item.pageIndex === pageIndex);
                            return (
                              <button
                                className={selectedPdfPage === pageIndex ? "pdf-thumbnail selected" : "pdf-thumbnail"}
                                key={pageIndex}
                                onClick={() => void showPdfPage(pageIndex)}
                                aria-label={`Select page ${position + 1}`}
                                aria-pressed={selectedPdfPage === pageIndex}
                              >
                                {thumbnail && <img src={thumbnail.image} alt="" />}
                                <span>{position + 1}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className="pdf-page-note"><Icon name="shield" /> Page edits and placement are local. Text conversion may change complex PDF layouts.</div>
                    </div>
                  )}
                  <div className="editor-section">
                    <div className="editor-title-row">
                      <div><span className="section-kicker">{kind === "pdf" ? "EDITABLE TEXT" : "DOCUMENT CONTENT"}</span><h2>{kind === "pdf" ? "Edit as a Word document" : "Document text"}</h2></div>
                      {kind === "pdf" && <span className="edit-note">PDF layout may change when exported</span>}
                    </div>
                    <textarea
                      className="document-editor"
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      placeholder="Your document text appears here. For scanned PDFs without text, use OCR before importing."
                      aria-label="Editable document text"
                      rows={10}
                    />
                    <div className="editor-footnote">Line breaks are kept. Rich formatting and complex page layouts may not be preserved in mobile offline conversion.</div>
                  </div>
                </div>
                <aside className="tools-panel">
                  <div className="tools-panel-heading"><div className="eyebrow">TOOLS</div><span><Icon name="sliders" /></span></div>
                  {kind === "pdf" && (
                    <div className="tool-group">
                      <div className="tool-heading">Signature</div>
                      <button className="tool-button" onClick={() => { setShowSignaturePad(true); setPlacing(null); }}><span className="tool-button-icon"><Icon name="pen" /></span><span><strong>Draw signature</strong><small>Sign with your finger or mouse</small></span><Icon name="chevron" /></button>
                      <button className="tool-button" onClick={() => signatureInput.current?.click()}><span className="tool-button-icon"><Icon name="image" /></span><span><strong>Upload signature</strong><small>PNG or JPEG from this device</small></span><Icon name="chevron" /></button>
                      {signature && <button className="button button-soft tool-wide" onClick={() => { setPlacing("signature"); setToast({ message: "Tap the PDF preview to place your signature.", tone: "info" }); }}><Icon name="pin" /> Place signature</button>}
                    </div>
                  )}
                  {kind === "pdf" && (
                    <div className="tool-group">
                      <div className="tool-heading">Company branding</div>
                      <button className="tool-button" onClick={() => logoInput.current?.click()}><span className="tool-button-icon"><Icon name="image" /></span><span><strong>Upload company logo</strong><small>PNG or JPEG from this device</small></span><Icon name="chevron" /></button>
                      {logo && <button className="button button-soft tool-wide" onClick={() => { setPlacing("logo"); setToast({ message: "Tap the PDF preview to place your logo.", tone: "info" }); }}><Icon name="pin" /> Place logo</button>}
                    </div>
                  )}
                  <div className="tool-group">
                    <div className="tool-heading">Personalize document</div>
                    <label className="field-label" htmlFor="person-name">Full name</label>
                    <input id="person-name" className="field-input" value={personName} onChange={(event) => setPersonName(event.target.value)} placeholder="e.g. Alex Morgan" />
                    <label className="field-label" htmlFor="document-date">Date <span>from this device</span></label>
                    <input id="document-date" className="field-input" type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} />
                    <button className="button button-outline tool-wide" onClick={applyFields}>Fill name &amp; date</button>
                    <small className="field-tip">Use <code>{"{{name}}"}</code> and <code>{"{{date}}"}</code> in templates.</small>
                  </div>
                  <div className="tool-group template-save-group">
                    <div className="tool-heading">Save for later</div>
                    <label className="field-label" htmlFor="template-name">Template name</label>
                    <input id="template-name" className="field-input" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="e.g. Employment agreement" />
                    <button className="button button-soft tool-wide" onClick={() => void saveDocumentTemplate()} disabled={!text.trim()}><Icon name="bookmark" /> Save document template</button>
                  </div>
                  {signature && (
                    <div className="tool-group template-save-group">
                      <div className="tool-heading">Reusable signature</div>
                      <input className="field-input" value={signatureTemplateName} onChange={(event) => setSignatureTemplateName(event.target.value)} placeholder="Name this signature" aria-label="Signature template name" />
                      <button className="button button-soft tool-wide" onClick={() => void saveSignatureTemplate()}><Icon name="bookmark" /> Save signature template</button>
                    </div>
                  )}
                  <div className="export-box">
                    <div className="tool-heading">Export</div>
                    {kind === "pdf" ? (
                      <>
                        <button className="button button-primary tool-wide" onClick={() => void downloadWord()} disabled={busy}><Icon name="word" /> Download as Word</button>
                        <button className="button button-outline tool-wide" onClick={() => void downloadEditedPdf()} disabled={busy}><Icon name="download" /> Export PDF</button>
                      </>
                    ) : (
                      <>
                        <button className="button button-outline tool-wide" onClick={() => void downloadWord()} disabled={busy}><Icon name="word" /> Download Word</button>
                        <button className="button button-primary tool-wide" onClick={() => void downloadPdf()} disabled={busy}><Icon name="download" /> Export as PDF</button>
                      </>
                    )}
                    {busy && <span className="working-text"><span className="spinner" /> Processing on this device…</span>}
                  </div>
                </aside>
              </div>
            )}
          </section>
        )}
      </main>

      <input ref={fileInput} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={onFileChange} />
      <input ref={signatureInput} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => void attachImage(event, "signature")} />
      <input ref={logoInput} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => void attachImage(event, "logo")} />
      {showSignaturePad && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowSignaturePad(false)}>
          <section className="signature-modal" role="dialog" aria-modal="true" aria-labelledby="signature-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-top"><div><div className="eyebrow">YOUR SIGNATURE</div><h2 id="signature-title">Draw your signature</h2></div><button className="icon-button" aria-label="Close" onClick={() => setShowSignaturePad(false)}>×</button></div>
            <p>Draw below using your finger, stylus or mouse. It stays on this device.</p>
            <canvas
              ref={signatureCanvas}
              className="signature-canvas"
              width={720}
              height={250}
              onPointerDown={startDrawing}
              onPointerMove={continueDrawing}
              onPointerUp={finishDrawing}
              onPointerCancel={finishDrawing}
              onPointerLeave={finishDrawing}
            />
            <div className="signature-actions"><button className="button button-quiet" onClick={clearSignatureCanvas}>Clear</button><button className="button button-primary" onClick={keepSignature}><Icon name="check" /> Use signature</button></div>
          </section>
        </div>
      )}
      {toast && <div className={`toast ${toast.tone}`} role="status"><span className="toast-mark">{toast.tone === "error" ? "!" : toast.tone === "success" ? "✓" : "i"}</span>{toast.message}<button aria-label="Dismiss notification" onClick={() => setToast(null)}>×</button></div>}
    </div>
  );
}

function pageTitle(page: Page) {
  if (page === "workspace") return "Document studio";
  if (page === "templates") return "My templates";
  return "Overview";
}

function Overview({
  onNew,
  onUpload,
  onTemplates,
  templates,
  onUseTemplate,
  busy,
}: {
  onNew: () => void;
  onUpload: () => void;
  onTemplates: () => void;
  templates: SavedTemplate[];
  onUseTemplate: (template: SavedTemplate) => void;
  busy: boolean;
}) {
  return (
    <section className="overview-page">
      <div className="welcome-row">
        <div className="page-heading">
          <div className="eyebrow">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()} · YOUR PRIVATE WORKSPACE</div>
          <h1>Good work starts here.</h1>
          <p>Prepare, sign and convert documents — all on your device.</p>
        </div>
        <button className="button button-primary" onClick={onNew}><Icon name="plus" /> New document</button>
      </div>
      <div className="hero-card">
        <div className="hero-copy">
          <div className="hero-kicker"><span /> YOUR DOCUMENTS. YOUR DEVICE.</div>
          <h2>Paperwork, without<br />the busywork.</h2>
          <p>Convert a PDF to an editable Word document, add your signature and logo, then save it right back to PDF.</p>
          <button className="button button-light" onClick={onUpload} disabled={busy}><Icon name="upload" /> Choose a document <Icon name="arrowRight" /></button>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-back-sheet"></div>
          <div className="art-sheet">
            <div className="art-sheet-head"><span>AGREEMENT</span><i /></div>
            <div className="art-lines"><i /><i /><i /><i /></div>
            <div className="art-signature">A. Morgan</div>
            <div className="art-date">SIGNED · 15 OCT 2026</div>
            <div className="art-seal"><Icon name="check" /></div>
          </div>
          <div className="art-shield"><Icon name="shield" /><span>100%<small>LOCAL</small></span></div>
          <div className="art-sparkle">✳</div>
        </div>
      </div>
      <div className="section-row">
        <div><div className="eyebrow">GET STARTED</div><h2>Everything you need, in one place.</h2></div>
      </div>
      <div className="feature-grid">
        <FeatureCard icon="arrows" tone="green" number="01" title="Convert documents" description="PDF to editable Word, or Word to a shareable PDF. Everything happens locally." action="Open document studio" onClick={onNew} />
        <FeatureCard icon="pen" tone="sand" number="02" title="Sign with confidence" description="Draw a signature or upload one, add your company logo and place them on a PDF." action="Prepare a document" onClick={onNew} />
        <FeatureCard icon="layers" tone="blue" number="03" title="Reuse templates" description="Save your own document and signature templates. They never leave your device." action="View my templates" onClick={onTemplates} />
      </div>
      <div className="recent-row">
        <div><div className="eyebrow">YOUR LIBRARY</div><h2>Saved templates <span className="count-pill">{templates.length}</span></h2></div>
        <button className="text-button" onClick={onTemplates}>See all <Icon name="arrowRight" /></button>
      </div>
      {templates.length ? (
        <div className="template-strip">
          {templates.slice(0, 3).map((template) => <TemplateCard key={template.id} template={template} onUse={onUseTemplate} compact />)}
        </div>
      ) : (
        <button className="empty-library" onClick={onNew}><span className="empty-icon"><Icon name="bookmark" /></span><span><strong>No templates saved yet</strong><small>Open a company document and save it as a template when you’re ready.</small></span><Icon name="arrowRight" /></button>
      )}
      <div className="privacy-banner"><span className="privacy-icon"><Icon name="shield" /></span><span><strong>Private by design</strong><small>Your documents and signatures are processed locally and never uploaded.</small></span><span className="offline-pill"><i /> OFFLINE READY</span></div>
    </section>
  );
}

function FeatureCard({
  icon, tone, number, title, description, action, onClick,
}: {
  icon: IconName;
  tone: string;
  number: string;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button className="feature-card" onClick={onClick}>
      <div className="feature-card-top"><span className={`feature-icon ${tone}`}><Icon name={icon} /></span><span className="feature-number">{number}</span></div>
      <h3>{title}</h3><p>{description}</p><span className="feature-action">{action}<Icon name="arrowRight" /></span>
    </button>
  );
}

function TemplatesPage({
  templates,
  onUse,
  onDelete,
  onUpload,
  onNew,
}: {
  templates: SavedTemplate[];
  onUse: (template: SavedTemplate) => void;
  onDelete: (id: string) => void;
  onUpload: () => void;
  onNew: () => void;
}) {
  return (
    <section className="templates-page">
      <div className="welcome-row">
        <div className="page-heading"><div className="eyebrow">YOUR PERSONAL LIBRARY</div><h1>My templates</h1><p>Saved on this device, ready whenever you need them.</p></div>
        <button className="button button-primary" onClick={onUpload}><Icon name="upload" /> Create from document</button>
      </div>
      <div className="template-explainer"><span className="privacy-icon"><Icon name="shield" /></span><span><strong>Only saved when you choose.</strong><small>Choose “Save document template” in the studio to add a company document, or save a signature you draw or upload.</small></span></div>
      {templates.length ? (
        <div className="template-grid">
          {templates.map((template) => (
            <div className="template-card-wrap" key={template.id}>
              <TemplateCard template={template} onUse={onUse} />
              <button className="template-delete" onClick={() => onDelete(template.id)} aria-label={`Delete ${template.name}`} title="Delete template"><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="large-empty">
          <div className="empty-illustration"><Icon name="layers" /></div>
          <h2>Your library is ready for you.</h2>
          <p>Save your own company documents or reusable signature templates. Nothing is added until you decide to save it.</p>
          <button className="button button-primary" onClick={onNew}><Icon name="plus" /> Open document studio</button>
        </div>
      )}
      <div className="privacy-banner templates-privacy"><span className="privacy-icon"><Icon name="shield" /></span><span><strong>Private by design</strong><small>Templates stay in this device’s local storage. They are never synced to a cloud service.</small></span><span className="offline-pill"><i /> ON THIS DEVICE</span></div>
    </section>
  );
}

function TemplateCard({
  template,
  onUse,
  compact = false,
}: {
  template: SavedTemplate;
  onUse: (template: SavedTemplate) => void;
  compact?: boolean;
}) {
  return (
    <button className={compact ? "template-card compact" : "template-card"} onClick={() => onUse(template)}>
      <div className="template-preview">
        {template.type === "signature" ? <img src={template.content} alt="" /> : <div className="template-paper"><i /><i /><i /><i /><i className="short" /><b>NAME · DATE</b></div>}
      </div>
      <div className="template-card-body">
        <span className={`template-type ${template.type}`}>{template.type === "signature" ? "SIGNATURE" : "DOCUMENT"}</span>
        <strong>{template.name}</strong>
        <small>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(template.createdAt))}</small>
      </div>
      {!compact && <span className="template-open"><Icon name="arrowRight" /></span>}
    </button>
  );
}

type IconName =
  | "document" | "grid" | "edit" | "layers" | "shield" | "more" | "download"
  | "plus" | "upload" | "arrowRight" | "arrows" | "pen" | "image" | "info"
  | "sliders" | "chevron" | "pin" | "bookmark" | "word" | "check" | "trash"
  | "rotate" | "up" | "down";

function Icon({ name }: { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<IconName, ReactNode> = {
    document: <><path d="M7 3.75h7l5 5v11.5H7a2 2 0 0 1-2-2v-12a2.5 2.5 0 0 1 2-2.5Z" /><path d="M14 4v5h5M9 13h6M9 16.5h6" /></>,
    grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
    edit: <><path d="m14.5 6.5 3 3M4 20l4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z" /><path d="M12 20h8" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    shield: <><path d="M12 3 19 6v5c0 4.7-3.1 8-7 10-3.9-2-7-5.3-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M5 16v4h14v-4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4" /><path d="M5 15v5h14v-5" /></>,
    arrowRight: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    arrows: <><path d="M7 7h12l-3-3m3 3-3 3M17 17H5l3 3m-3-3 3-3" /></>,
    pen: <><path d="m4 20 4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z" /><path d="m14.5 6.5 3 3" /></>,
    image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m20 15-4-4L7 19" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></>,
    sliders: <><path d="M4 7h9m4 0h3M4 17h3m4 0h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    pin: <><path d="M12 21s7-5.5 7-12a7 7 0 1 0-14 0c0 6.5 7 12 7 12Z" /><circle cx="12" cy="9" r="2.3" /></>,
    bookmark: <><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z" /></>,
    word: <><path d="M7 3.5h7l5 5v12H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" /><path d="M14 4v5h5M8.5 12l2 5 1.5-3.5 1.5 3.5 2-5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    trash: <><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    rotate: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 18 6l2 1m-2 10a7 7 0 0 1-12.5 3L4 19" /></>,
    up: <path d="m6 14 6-6 6 6" />,
    down: <path d="m6 10 6 6 6-6" />,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

export default App;
