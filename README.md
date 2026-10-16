# Papertrail

Papertrail is an offline-first document studio with a responsive, installable web app and an optional local template-vault backend. All document parsing, conversion, PDF changes, signatures, and logos are processed on the device. There is no cloud account or document upload.

## Run locally

Install Node.js 20 or newer, then from this folder:

```powershell
npm install --prefix frontend
npm run dev
```

Open the local address printed by Vite. To use the optional backend-backed template vault, start it in a second terminal:

```powershell
npm run backend
```

The backend listens only on `127.0.0.1` and stores opted-in templates in `backend/data/templates.json`. If it is not running, templates are saved in this browser's IndexedDB instead. Document files are never sent to the backend. Exported files are downloaded by the browser.

Create a production frontend build with `npm run build`. The PWA caches its local app shell and same-origin assets for use after installation. To install on mobile, open the deployed app once in a supported browser and choose its install/add-to-home-screen action; documents and templates remain on that device.

## Included

- PDF to editable DOCX and DOCX to PDF conversion, processed in the browser.
- PDF signing and branding with a drawn or uploaded signature and an uploaded logo.
- PDF page rotation, reordering, and deletion.
- User-selected document and signature templates with `{{name}}` and `{{date}}` fields.
- Responsive layouts for desktop and mobile.

## Conversion notes

PDF-to-DOCX uses extracted PDF text; scanned pages need OCR before they contain editable text. Editing a PDF's extracted text and exporting it creates a newly flowed PDF, so original page layout and page order cannot be retained in that path. DOCX conversion supports text and line breaks; complex formatting, tables, and page layouts may change. PDF overlays are placed on the selected page. All conversions run locally.
