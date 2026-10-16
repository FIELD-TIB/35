import { openDB } from "idb";

export type SavedTemplate = {
  id: string;
  name: string;
  type: "document" | "signature";
  content: string;
  createdAt: string;
};

const DATABASE_NAME = "papertrail-local";
const STORE_NAME = "templates";
const BACKEND_URL = "http://127.0.0.1:4174/api/templates";

const database = openDB(DATABASE_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: "id" });
    }
  },
});

async function localTemplates(): Promise<SavedTemplate[]> {
  return (await database).getAll(STORE_NAME);
}

async function writeLocalTemplates(templates: SavedTemplate[]): Promise<void> {
  const db = await database;
  const transaction = db.transaction(STORE_NAME, "readwrite");
  await transaction.store.clear();
  for (const template of templates) await transaction.store.put(template);
  await transaction.done;
}

export async function loadTemplates(): Promise<SavedTemplate[]> {
  try {
    const response = await fetch(BACKEND_URL);
    if (!response.ok) throw new Error("The local template vault could not be read.");
    const vault = (await response.json()) as SavedTemplate[];
    const local = await localTemplates();
    return [...vault, ...local.filter((item) => !vault.some((saved) => saved.id === item.id))];
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return localTemplates();
  }
}

export async function saveTemplate(template: SavedTemplate): Promise<"vault" | "device"> {
  try {
    const response = await fetch(BACKEND_URL);
    if (!response.ok) throw new Error("The local template vault could not be read.");
    const vault = (await response.json()) as SavedTemplate[];
    const local = await localTemplates();
    const updated = [template, ...[...vault, ...local].filter((item) => item.id !== template.id)];
    const writeResponse = await fetch(BACKEND_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    if (!writeResponse.ok) throw new Error("The local template vault could not save this template.");
    await writeLocalTemplates(updated);
    return "vault";
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    const templates = await localTemplates();
    await writeLocalTemplates([template, ...templates.filter((item) => item.id !== template.id)]);
    return "device";
  }
}

export async function deleteTemplate(id: string): Promise<void> {
  try {
    const response = await fetch(BACKEND_URL);
    if (!response.ok) throw new Error("The local template vault could not be read.");
    const templates = (await response.json()) as SavedTemplate[];
    const writeResponse = await fetch(BACKEND_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(templates.filter((template) => template.id !== id)),
    });
    if (!writeResponse.ok) throw new Error("The local template vault could not delete this template.");
    const local = await localTemplates();
    await writeLocalTemplates(local.filter((template) => template.id !== id));
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    const templates = await localTemplates();
    await writeLocalTemplates(templates.filter((template) => template.id !== id));
  }
}
