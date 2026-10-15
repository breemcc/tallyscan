// IndexedDB storage: sheets (with field definitions) and rows (one per scan/record).
const DB_NAME = "tallyscan";
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("sheets", { keyPath: "id" });
      const rows = db.createObjectStore("rows", { keyPath: "id" });
      rows.createIndex("sheetId", "sheetId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

const uid = () => crypto.randomUUID();

export const db = {
  uid,
  listSheets: () => tx("sheets", "readonly", (s) => s.getAll()),
  getSheet: (id) => tx("sheets", "readonly", (s) => s.get(id)),
  saveSheet: (sheet) => tx("sheets", "readwrite", (s) => s.put(sheet)),
  async deleteSheet(id) {
    const rows = await this.listRows(id);
    await Promise.all(rows.map((r) => this.deleteRow(r.id)));
    return tx("sheets", "readwrite", (s) => s.delete(id));
  },
  listRows: (sheetId) =>
    tx("rows", "readonly", (s) => s.index("sheetId").getAll(sheetId)),
  getRow: (id) => tx("rows", "readonly", (s) => s.get(id)),
  saveRow: (row) => tx("rows", "readwrite", (s) => s.put(row)),
  deleteRow: (id) => tx("rows", "readwrite", (s) => s.delete(id)),
};

export function newSheet(name) {
  const now = Date.now();
  return {
    id: uid(),
    name,
    allowDuplicates: false,
    fields: [
      { id: uid(), name: "Name", type: "text" },
      { id: uid(), name: "Quantity", type: "number" },
    ],
    createdAt: now,
  };
}

export function newRow(sheetId, barcode) {
  const now = Date.now();
  return { id: uid(), sheetId, barcode, values: {}, createdAt: now, updatedAt: now };
}

export const FIELD_TYPES = ["text", "number", "currency", "date", "checkbox", "notes"];
