import { db, newSheet, newRow, FIELD_TYPES } from "./db.js";
import { sheetToCsv } from "./csv.js";
import { startScanner } from "./scanner.js";

const app = document.querySelector("#app");
let stopCamera = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const $ = (sel, root = app) => root.querySelector(sel);
const go = (hash) => { location.hash = hash; };
const inputType = { text: "text", number: "number", currency: "number", date: "date" };

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

function header(title, back) {
  return `<header>${back ? `<a class="back" href="${back}" aria-label="Back">‹</a>` : ""}<h1>${esc(title)}</h1></header>`;
}

// ---------- Sheets list ----------
async function viewSheets() {
  const sheets = (await db.listSheets()).sort((a, b) => b.createdAt - a.createdAt);
  const counts = await Promise.all(sheets.map(async (s) => (await db.listRows(s.id)).length));
  app.innerHTML = `${header("Sheets")}
    <main>
      ${sheets.length ? `<ul class="list">${sheets.map((s, i) => `
        <li><a href="#/sheet/${s.id}"><strong>${esc(s.name)}</strong><span>${counts[i]} rows</span></a></li>`).join("")}</ul>`
        : `<p class="empty">No sheets yet. Create one to start scanning.</p>`}
      <form id="new" class="inline"><input name="name" placeholder="New sheet name" required maxlength="60"><button>Add</button></form>
    </main>`;
  $("#new").onsubmit = async (e) => {
    e.preventDefault();
    const sheet = newSheet(new FormData(e.target).get("name").trim());
    await db.saveSheet(sheet);
    go(`/sheet/${sheet.id}`);
  };
}

// ---------- Rows list ----------
async function viewSheet(id) {
  const sheet = await db.getSheet(id);
  if (!sheet) return go("/");
  let rows = (await db.listRows(id)).sort((a, b) => b.updatedAt - a.updatedAt);
  app.innerHTML = `${header(sheet.name, "#/")}
    <main>
      <div class="bar">
        <input id="q" type="search" placeholder="Search ${rows.length} rows" aria-label="Search">
        <a class="btn ghost" href="#/sheet/${id}/settings">Fields</a>
        <button id="export" class="ghost">Export CSV</button>
      </div>
      <ul class="list" id="rows"></ul>
    </main>
    <a class="fab" href="#/sheet/${id}/scan">Scan</a>`;
  const draw = (q = "") => {
    const needle = q.toLowerCase();
    const shown = rows.filter((r) => !needle ||
      r.barcode.toLowerCase().includes(needle) ||
      Object.values(r.values).some((v) => String(v).toLowerCase().includes(needle)));
    $("#rows").innerHTML = shown.length ? shown.map((r) => {
      const summary = sheet.fields.map((f) => r.values[f.id]).filter((v) => v !== "" && v != null && v !== false).slice(0, 2).join(" · ");
      return `<li><a href="#/sheet/${id}/row/${r.id}"><strong>${esc(r.barcode)}</strong><span>${esc(summary)}</span></a></li>`;
    }).join("") : `<li class="empty">${rows.length ? "No matches" : "Nothing scanned yet"}</li>`;
  };
  draw();
  $("#q").oninput = (e) => draw(e.target.value);
  $("#export").onclick = () => exportCsv(sheet, rows);
}

async function exportCsv(sheet, rows) {
  const name = `${sheet.name.replace(/[^\w\- ]+/g, "").trim() || "sheet"}.csv`;
  const file = new File([sheetToCsv(sheet, rows)], name, { type: "text/csv" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Scan ----------
async function viewScan(sheetId) {
  const sheet = await db.getSheet(sheetId);
  if (!sheet) return go("/");
  app.innerHTML = `${header("Scan", `#/sheet/${sheetId}`)}
    <main class="scan">
      <div class="viewfinder"><video playsinline muted></video><div class="reticle"></div></div>
      <p id="cam-msg" class="hint">Point the camera at a barcode or QR code.</p>
      <form id="manual" class="inline">
        <input name="code" placeholder="Or type / use a Bluetooth scanner" autocomplete="off" autocapitalize="off">
        <button>Add</button>
      </form>
    </main>`;
  const handle = async (code) => {
    code = code.trim();
    if (!code) return;
    navigator.vibrate?.(60);
    const rows = await db.listRows(sheetId);
    const existing = rows.find((r) => r.barcode === code);
    if (existing && !sheet.allowDuplicates) {
      toast("Already in sheet — opening");
      return go(`/sheet/${sheetId}/row/${existing.id}`);
    }
    const row = newRow(sheetId, code);
    await db.saveRow(row);
    go(`/sheet/${sheetId}/row/${row.id}?new=1`);
  };
  $("#manual").onsubmit = (e) => { e.preventDefault(); handle(new FormData(e.target).get("code")); };
  try {
    stopCamera = await startScanner($("video"), handle);
  } catch (err) {
    $("#cam-msg").textContent = `Camera unavailable: ${err.message}. You can still type a code below.`;
    $(".viewfinder").hidden = true;
  }
}

// ---------- Row editor ----------
async function viewRow(sheetId, rowId, isNew) {
  const [sheet, row] = await Promise.all([db.getSheet(sheetId), db.getRow(rowId)]);
  if (!sheet || !row) return go(`/sheet/${sheetId}`);
  const control = (f) => {
    const v = row.values[f.id];
    if (f.type === "checkbox") return `<label class="check"><input type="checkbox" data-f="${f.id}" ${v ? "checked" : ""}> ${esc(f.name)}</label>`;
    if (f.type === "notes") return `<label>${esc(f.name)}<textarea data-f="${f.id}" rows="3">${esc(v)}</textarea></label>`;
    const step = f.type === "currency" ? ` step="0.01"` : f.type === "number" ? ` step="any"` : "";
    return `<label>${esc(f.name)}<input data-f="${f.id}" type="${inputType[f.type]}"${step} value="${esc(v)}"></label>`;
  };
  app.innerHTML = `${header(isNew ? "New record" : "Edit record", `#/sheet/${sheetId}`)}
    <main>
      <form id="row">
        <label>Barcode<input name="barcode" value="${esc(row.barcode)}" required></label>
        ${sheet.fields.map(control).join("")}
        <p class="meta">Created ${new Date(row.createdAt).toLocaleString()} · Updated ${new Date(row.updatedAt).toLocaleString()}</p>
        <div class="actions">
          <button type="submit">Save</button>
          ${isNew ? `<button type="button" id="save-scan">Save &amp; scan next</button>` : ""}
          <button type="button" id="del" class="danger">Delete</button>
        </div>
      </form>
    </main>`;
  const save = async () => {
    const form = $("#row");
    row.barcode = form.barcode.value.trim();
    for (const el of form.querySelectorAll("[data-f]")) {
      row.values[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value;
    }
    row.updatedAt = Date.now();
    await db.saveRow(row);
  };
  $("#row").onsubmit = async (e) => { e.preventDefault(); await save(); go(`/sheet/${sheetId}`); };
  $("#save-scan")?.addEventListener("click", async () => { await save(); go(`/sheet/${sheetId}/scan`); });
  $("#del").onclick = async () => {
    if (confirm("Delete this record?")) { await db.deleteRow(rowId); go(`/sheet/${sheetId}`); }
  };
}

// ---------- Sheet settings / fields ----------
async function viewSettings(sheetId) {
  const sheet = await db.getSheet(sheetId);
  if (!sheet) return go("/");
  app.innerHTML = `${header("Sheet settings", `#/sheet/${sheetId}`)}
    <main>
      <form id="settings">
        <label>Name<input name="name" value="${esc(sheet.name)}" required></label>
        <label class="check"><input type="checkbox" name="dups" ${sheet.allowDuplicates ? "checked" : ""}> Allow duplicate barcodes (each scan adds a new row)</label>
        <h2>Fields</h2>
        <ul id="fields" class="fields"></ul>
        <button type="button" id="add-field" class="ghost">+ Add field</button>
        <div class="actions"><button type="submit">Save</button><button type="button" id="del" class="danger">Delete sheet</button></div>
      </form>
    </main>`;
  const draw = () => {
    $("#fields").innerHTML = sheet.fields.map((f, i) => `
      <li data-i="${i}">
        <input class="fname" value="${esc(f.name)}" aria-label="Field name" required>
        <select aria-label="Field type">${FIELD_TYPES.map((t) => `<option ${t === f.type ? "selected" : ""}>${t}</option>`).join("")}</select>
        <button type="button" class="rm" aria-label="Remove field">✕</button>
      </li>`).join("");
    for (const li of $("#fields").children) {
      const f = sheet.fields[li.dataset.i];
      li.querySelector(".fname").oninput = (e) => { f.name = e.target.value; };
      li.querySelector("select").onchange = (e) => { f.type = e.target.value; };
      li.querySelector(".rm").onclick = () => {
        if (confirm(`Remove "${f.name}"? Values in existing rows will be hidden.`)) {
          sheet.fields.splice(li.dataset.i, 1); draw();
        }
      };
    }
  };
  draw();
  $("#add-field").onclick = () => { sheet.fields.push({ id: db.uid(), name: "New field", type: "text" }); draw(); };
  $("#settings").onsubmit = async (e) => {
    e.preventDefault();
    sheet.name = e.target.name.value.trim();
    sheet.allowDuplicates = e.target.dups.checked;
    await db.saveSheet(sheet);
    go(`/sheet/${sheetId}`);
  };
  $("#del").onclick = async () => {
    if (confirm(`Delete "${sheet.name}" and all its rows?`)) { await db.deleteSheet(sheetId); go("/"); }
  };
}

// ---------- Router ----------
async function route() {
  stopCamera?.(); stopCamera = null;
  const [path, query = ""] = location.hash.slice(1).split("?");
  const p = path.split("/").filter(Boolean);
  try {
    if (!p.length) await viewSheets();
    else if (p[0] === "sheet" && p.length === 2) await viewSheet(p[1]);
    else if (p[0] === "sheet" && p[2] === "scan") await viewScan(p[1]);
    else if (p[0] === "sheet" && p[2] === "settings") await viewSettings(p[1]);
    else if (p[0] === "sheet" && p[2] === "row") await viewRow(p[1], p[3], new URLSearchParams(query).has("new"));
    else go("/");
  } catch (err) {
    app.innerHTML = `${header("Error", "#/")}<main><p class="empty">${esc(err.message)}</p></main>`;
  }
  window.scrollTo(0, 0);
}
addEventListener("hashchange", route);
route();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
