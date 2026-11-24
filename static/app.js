async function api(url, {method = "GET", body,keepalive = false} = {}) {
    const res = await fetch(url, {
        method,
        headers: {"Content-Type": "application/json"},
        body: body === undefined ? undefined : JSON.stringify(body),
        keepalive,
    });
    if (!res.ok) {
        let message =`Błąd serwera (${res.status})`;
        try { message = (await res.json()).error || message;} catch {/* brak JSON */}
        throw new Error(message);   
     }
    return res.status === 204 ? null : res.json();
}

function showError(err){
    console.error(err);
    alert(err.message || "Wystąpił błąd.");
}

const $ = (sell) => document.querySelector(sel);

let settings = null;
const grid = $("#grid");
const themeSelect = $("#theme-select");

function applyLayout() {
  document.documentElement.dataset.theme = settings.theme;
  themeSelect.value = settings.theme;

  // kolejnosc: dopinamy kafelki do siatki w zapisanej kolejnosci
  settings.layout.forEach((name) => {
    grid.appendChild(grid.querySelector(`[data-tile="${name}"]`));
  });

  // widocznosc
  grid.querySelectorAll(".tile").forEach((tile) => {
    tile.classList.toggle("is-hidden", settings.hidden.includes(tile.dataset.tile));
  });
  document.querySelectorAll("[data-toggle]").forEach((box) => {
    box.checked = !settings.hidden.includes(box.dataset.toggle);
  });
}

async function saveSettings(patch) {
  settings = await api("/api/settings", { method: "PUT", body: patch });
}

themeSelect.addEventListener("change", async () => {
  try {
    await saveSettings({ theme: themeSelect.value });
    applyLayout();
  } catch (err) { showError(err); }
});

document.querySelectorAll("[data-toggle]").forEach((box) => {
  box.addEventListener("change", async () => {
    const hidden = [...document.querySelectorAll("[data-toggle]")]
      .filter((b) => !b.checked)
      .map((b) => b.dataset.toggle);
    try {
      await saveSettings({ hidden });
      applyLayout();
    } catch (err) { showError(err); }
  });
});

let draggedTile = null;

grid.querySelectorAll(".tile").forEach((tile) => {
  const handle = tile.querySelector(".drag-handle");

  handle.addEventListener("mousedown", () => { tile.draggable = true; });
  handle.addEventListener("mouseup", () => { tile.draggable = false; });

  tile.addEventListener("dragstart", (e) => {
    draggedTile = tile;
    tile.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tile.dataset.tile); // wymagane przez Firefox
  });

  tile.addEventListener("dragover", (e) => {
    if (!draggedTile || draggedTile === tile) return;
    e.preventDefault(); // pozwala upuscic element
    tile.classList.add("drag-over");
  });

  tile.addEventListener("dragleave", () => tile.classList.remove("drag-over"));

  tile.addEventListener("drop", (e) => {
    e.preventDefault();
    tile.classList.remove("drag-over");
    if (!draggedTile || draggedTile === tile) return;

    const tiles = [...grid.children];
    if (tiles.indexOf(draggedTile) < tiles.indexOf(tile)) {
      tile.after(draggedTile);   // przeciagamy "w przod" -> wstaw za celem
    } else {
      tile.before(draggedTile);  // przeciagamy "w tyl" -> wstaw przed celem
    }
  });

  tile.addEventListener("dragend", async () => {
    tile.draggable = false;
    tile.classList.remove("dragging");
    grid.querySelectorAll(".drag-over").forEach((t) => t.classList.remove("drag-over"));
    draggedTile = null;

    const layout = [...grid.children].map((t) => t.dataset.tile);
    try { await saveSettings({ layout }); } catch (err) { showError(err); }
  });
});

const taskForm        = $("#task-form");
const taskTitle       = $("#task-title");
const taskPriority    = $("#task-priority");
const taskCategoryInput = $("#task-category");   //pole kategorii
const taskRecurInput    = $("#task-recur");       //pole "powtórz co X dni"
const taskList        = $("#task-list");
const tasksEmpty      = $("#tasks-empty");
const tasksCount      = $("#tasks-count");
const taskFilterCat    = $("#task-filter-cat");   //filtr po kategorii
const taskFilterStatus = $("#task-filter-status"); //filtr po statusie
const categoryDatalist = $("#category-list");      //<datalist> dla autocomplete

const PRIORITY_LABELS = { low: "Niski", medium: "Średni", high: "Wysoki" };
let tasks = [];
let allCategories = [];


async function loadCategories() {
  try { allCategories = await api("/api/tasks/categories"); } catch { allCategories = []; }
  categoryDatalist.replaceChildren(
    ...allCategories.map((c) => el("option", { value: c }))
  );
  const current = taskFilterCat.value;
  taskFilterCat.replaceChildren(new Option("Wszystkie kategorie", ""));
  allCategories.forEach((c) => taskFilterCat.appendChild(new Option(c, c)));
  if (allCategories.includes(current)) taskFilterCat.value = current;
}

async function loadTasks() {
  
  const params = new URLSearchParams();
  if (taskFilterStatus.value) params.set("status", taskFilterStatus.value);
  if (taskFilterCat.value)    params.set("category", taskFilterCat.value);
  tasks = await api("/api/tasks" + (params.toString() ? "?" + params : ""));
  await loadCategories();
  renderTasks();
}

async function updateTask(id, patch) {
  try { await api(`/api/tasks/${id}`, { method: "PUT", body: patch }); await loadTasks(); }
  catch (err) { showError(err); renderTasks(); }
}

function renderTasks() {
  taskList.replaceChildren(...tasks.map(taskItem));
  tasksCount.textContent = tasks.filter((t) => !t.done).length;
  tasksEmpty.hidden = tasks.length > 0;
}

function taskItem(task) {
  const check = el("input", { type: "checkbox", checked: task.done, "aria-label": "Oznacz jako wykonane",
    onChange: () => updateTask(task.id, { done: check.checked }) });

  const title = el("span", { className: "title", textContent: task.title,
    onDblclick: () => startEditTask(title, task) });

  const prio = el("select", { "aria-label": "Priorytet", onChange: () => updateTask(task.id, { priority: prio.value }) });
  for (const [v, l] of Object.entries(PRIORITY_LABELS)) prio.add(new Option(l, v, false, v === task.priority));

  const kids = [check, title];
  
  if (task.category) kids.push(el("span", { className: "task-category-badge", title: task.category, textContent: task.category }));
  
  if (task.recur_days > 0) kids.push(el("span", { className: "task-recur-badge", title: `Powtarza się co ${task.recur_days} dni`, textContent: `↺${task.recur_days}d` }));

  kids.push(
    prio,
    el("button", { type: "button", className: "icon", title: "Edytuj", textContent: "✎", onClick: () => startEditTask(title, task) }),
    el("button", { type: "button", className: "icon", title: "Usuń",   textContent: "✕",
      onClick: async () => { try { await api(`/api/tasks/${task.id}`, { method: "DELETE" }); await loadTasks(); } catch (err) { showError(err); } }
    }),
  );
  return el("li", { className: `task p-${task.priority}${task.done ? " done" : ""}` }, ...kids);
}

function startEditTask(titleEl, task) {
  const input = el("input", { type: "text", value: task.title, maxLength: 200 });
  titleEl.replaceWith(input);
  input.focus(); input.select();
  let finished = false;
  const finish = (save) => {
    if (finished) return; finished = true;
    const value = input.value.trim();
    if (save && value && value !== task.title) updateTask(task.id, { title: value });
    else renderTasks();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
  input.addEventListener("blur", () => finish(true));
}

taskForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const recurVal = parseInt(taskRecurInput.value, 10);
  try {
    await api("/api/tasks", { method: "POST", body: {
      title: taskTitle.value,
      priority: taskPriority.value,
      category: taskCategoryInput.value.trim(),  // [AI-GENERATED] NOWE: kategoria
      recur_days: Number.isInteger(recurVal) && recurVal >= 0 ? recurVal : 0, // [AI-GENERATED] NOWE: powtarzanie
    }});
    taskTitle.value = ""; taskCategoryInput.value = ""; taskRecurInput.value = "0";
    await loadTasks();
  } catch (err) { showError(err); }
});


taskFilterCat.addEventListener("change", loadTasks);
taskFilterStatus.addEventListener("change", loadTasks);


$("#task-export").addEventListener("click", () => {
  const rows = tasks.map((t) => ({
    "Tytuł": t.title, "Priorytet": PRIORITY_LABELS[t.priority] || t.priority,
    "Kategoria": t.category || "", "Status": t.done ? "Wykonane" : "Aktywne",
    "Powtarzanie (dni)": t.recur_days || 0, "Następne wykonanie": t.next_due || "", "Utworzono": t.created_at,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 40 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Zadania");
  XLSX.writeFile(wb, "zadania.xlsx");
});

const noteSelect  = $("#note-select");
const noteTitle   = $("#note-title");
const noteContent = $("#note-content");
const noteStatus  = $("#note-status");
const AUTOSAVE_DELAY_MS = 800;

let notes = [], currentNoteId = null, saveTimer = null;

const currentNote = () => notes.find((n) => n.id === currentNoteId) || null;

function renderNoteSelect() {
  noteSelect.replaceChildren(...notes.map((n) => new Option(n.title, n.id)));
  if (currentNoteId !== null) noteSelect.value = currentNoteId;
}

function showNote(id) {
  currentNoteId = id;
  const note = currentNote();
  noteTitle.value = note ? note.title : "";
  noteContent.value = note ? note.content : "";
  noteTitle.disabled = noteContent.disabled = !note;
  renderNoteSelect();
  try { localStorage.setItem("currentNoteId", String(id)); } catch { /* ignoruj */ }
}

async function saveCurrentNote(keepalive = false) {
  const note = currentNote();
  if (!note) return;
  clearTimeout(saveTimer); saveTimer = null;
  try {
    const saved = await api(`/api/notes/${note.id}`, { method: "PUT",
      body: { title: noteTitle.value, content: noteContent.value }, keepalive });
    Object.assign(note, saved);
    noteSelect.querySelector(`option[value="${note.id}"]`).textContent = note.title;
    noteStatus.textContent = "Zapisano " + new Date().toLocaleTimeString("pl-PL");
  } catch (err) { noteStatus.textContent = "Błąd zapisu!"; console.error(err); }
}

function scheduleSave() {
  noteStatus.textContent = "Zapisywanie…";
  const note = currentNote();
  if (note) { note.title = noteTitle.value; note.content = noteContent.value; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCurrentNote(), AUTOSAVE_DELAY_MS);
}

noteTitle.addEventListener("input", scheduleSave);
noteContent.addEventListener("input", scheduleSave);

noteSelect.addEventListener("change", async () => {
  if (saveTimer) await saveCurrentNote();
  showNote(Number(noteSelect.value));
  noteStatus.textContent = "—";
});

$("#note-new").addEventListener("click", async () => {
  try {
    if (saveTimer) await saveCurrentNote();
    const note = await api("/api/notes", { method: "POST", body: { title: "Nowa notatka" } });
    notes.unshift(note); showNote(note.id); noteTitle.select();
  } catch (err) { showError(err); }
});

$("#note-delete").addEventListener("click", async () => {
  const note = currentNote();
  if (!note || !confirm(`Usunąć notatkę „${note.title}"?`)) return;
  try {
    clearTimeout(saveTimer); saveTimer = null;
    await api(`/api/notes/${note.id}`, { method: "DELETE" });
    notes = notes.filter((n) => n.id !== note.id);
    showNote(notes.length ? notes[0].id : null);
    noteStatus.textContent = "Usunięto";
  } catch (err) { showError(err); }
});

window.addEventListener("beforeunload", () => { if (saveTimer) saveCurrentNote(true); });

async function loadNotes() {
  notes = await api("/api/notes");
  if (notes.length === 0) notes.push(await api("/api/notes", { method: "POST", body: { title: "Moja notatka" } }));
  let saved = null;
  try { saved = Number(localStorage.getItem("currentNoteId")); } catch { /* ignoruj */ }
  showNote((notes.find((n) => n.id === saved) || notes[0]).id);
}

const pomoTime  = $("#pomo-time");
const pomoMode  = $("#pomo-mode");
const pomoStart = $("#pomo-start");
const pomoWork  = $("#pomo-work");
const pomoBreak = $("#pomo-break");

let pomo = { mode: "work", remaining: 25 * 60, running: false, endTime: 0, interval: null };

const modeSeconds  = (mode) => (mode === "work" ? settings.pomodoro_work : settings.pomodoro_break) * 60;
const formatTime   = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function renderPomo() {
  pomoTime.textContent  = formatTime(pomo.remaining);
  pomoMode.textContent  = pomo.mode === "work" ? "Praca" : "Przerwa";
  pomoStart.textContent = pomo.running ? "Pauza" : "Start";
  document.title = pomo.running ? `${formatTime(pomo.remaining)} – Personal Dashboard` : "Personal Dashboard";
}

function stopTimer()  { clearInterval(pomo.interval); pomo.interval = null; pomo.running = false; }
function startTimer() { pomo.running = true; pomo.endTime = Date.now() + pomo.remaining * 1000; pomo.interval = setInterval(tick, 250); renderPomo(); }
function setMode(mode) { pomo.mode = mode; pomo.remaining = modeSeconds(mode); }

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880; osc.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.4);
  } catch { /* brak dzwieku - nic nie szkodzi */ }
}

async function tick() {
  pomo.remaining = Math.max(0, Math.round((pomo.endTime - Date.now()) / 1000));
  renderPomo();
  if (pomo.remaining > 0) return;
  stopTimer(); beep();
  if (pomo.mode === "work") {
    try { renderPomoStats(await api("/api/pomodoro", { method: "POST", body: { duration_min: settings.pomodoro_work } })); }
    catch (err) { showError(err); }
    setMode("break");
  } else { setMode("work"); }
  renderPomo();
}

pomoStart.addEventListener("click", () => { if (pomo.running) { stopTimer(); renderPomo(); } else if (pomo.remaining > 0) startTimer(); });
$("#pomo-reset").addEventListener("click", () => { stopTimer(); pomo.remaining = modeSeconds(pomo.mode); renderPomo(); });
$("#pomo-skip").addEventListener("click",  () => { stopTimer(); setMode(pomo.mode === "work" ? "break" : "work"); renderPomo(); });

function onDurationChange(input, key) {
  input.addEventListener("change", async () => {
    const value = parseInt(input.value, 10);
    if (!Number.isInteger(value) || value < 1 || value > 120) { input.value = settings[key]; return; }
    try { await saveSettings({ [key]: value }); if (!pomo.running) { pomo.remaining = modeSeconds(pomo.mode); renderPomo(); } }
    catch (err) { showError(err); }
  });
}
onDurationChange(pomoWork,  "pomodoro_work");
onDurationChange(pomoBreak, "pomodoro_break");

function renderPomoStats(stats) {
  $("#pomo-today").textContent   = stats.today;
  $("#pomo-total").textContent   = stats.total;
  $("#pomo-minutes").textContent = stats.total_minutes;
}

function applyView(persist = true) {
  boardWorld.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  const step = 24 * view.z;
  boardViewport.style.backgroundSize     = `${step}px ${step}px`;
  boardViewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
  zoomLabel.textContent = Math.round(view.z * 100) + "%";
  if (persist) try { localStorage.setItem("boardView", JSON.stringify(view)); } catch { /* ignoruj */ }
}

const toWorld = (e) => { const r = boardViewport.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.z, y: (e.clientY - r.top - view.y) / view.z }; };

function zoomAt(factor, cx, cy) {
  const z = clamp(view.z * factor, MIN_ZOOM, MAX_ZOOM), k = z / view.z;
  view.x = cx - (cx - view.x) * k; view.y = cy - (cy - view.y) * k; view.z = z;
  applyView();
}

function zoomCenter(factor) { const r = boardViewport.getBoundingClientRect(); zoomAt(factor, r.width / 2, r.height / 2); }

function fitView() {
  const r = boardViewport.getBoundingClientRect();
  if (board.items.length === 0) { view = { x: 40, y: 40, z: 1 }; return applyView(); }
  const minX = Math.min(...board.items.map((i) => i.x)), minY = Math.min(...board.items.map((i) => i.y));
  const maxX = Math.max(...board.items.map((i) => i.x + i.w)), maxY = Math.max(...board.items.map((i) => i.y + i.h));
  const pad = 40;
  view.z = clamp(Math.min((r.width - 2*pad) / (maxX - minX), (r.height - 2*pad) / (maxY - minY)), MIN_ZOOM, 1.5);
  view.x = (r.width  - (maxX - minX) * view.z) / 2 - minX * view.z;
  view.y = (r.height - (maxY - minY) * view.z) / 2 - minY * view.z;
  applyView();
}

// ---- rysowanie elementów ----------------------------------------------------
function buildItemEl(item) {
  const node = el("div", { "data-id": item.id });
  node.append(el("div", { className: "b-label" }), el("span", { className: "b-resize" }));
  paintItem(node, item);
  return node;
}

function paintItem(node, item) {
  if (!node) return;
  const isSel = selected && selected.kind === "item" && selected.id === item.id;
  node.className = `b-item t-${item.type} c-${item.color}` + (isSel ? " selected" : "") + (linkSource === item.id ? " link-source" : "");
  Object.assign(node.style, { left: item.x + "px", top: item.y + "px", width: item.w + "px", height: item.h + "px", zIndex: item.z });
  const label = node.querySelector(".b-label"); // brak w trakcie edycji (jest textarea)
  if (label) label.textContent = item.text;     // textContent -> brak ryzyka XSS
}

function renderBoard() {
  editing = null;
  qAll(".b-item", boardWorld).forEach((n) => n.remove());
  board.items.forEach((item) => boardWorld.appendChild(buildItemEl(item)));
  drawLinks();
  boardCount.textContent = board.items.length;
  boardEmpty.hidden = board.items.length > 0;
}

function refreshSelection() {
  qAll(".selected", boardWorld).forEach((n) => n.classList.remove("selected"));
  boardDeleteBtn.disabled = !selected;
  if (!selected) return;
  const node = selected.kind === "item" ? itemEl(selected.id) : boardSvg.querySelector(`.b-link[data-id="${selected.id}"]`);
  if (node) node.classList.add("selected");
}

function select(sel) { selected = sel; refreshSelection(); }

function edgePoint(item, target, gap) {
  const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
  const dx = target.x - cx, dy = target.y - cy;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: cx, y: cy };
  const t = item.type === "ellipse"
    ? 1 / Math.hypot(dx / (item.w / 2), dy / (item.h / 2))
    : Math.min(item.w / 2 / Math.abs(dx || 1e-9), item.h / 2 / Math.abs(dy || 1e-9));
  const scale = t + gap / len;
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function drawLinks() {
  boardSvg.replaceChildren();
  for (const link of board.links) {
    const a = itemById(link.from_id), b = itemById(link.to_id);
    if (!a || !b) continue;
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const p1 = edgePoint(a, cb, 3), p2 = edgePoint(b, ca, 3);
    // grot strzałki: trójkąt zakończony w punkcie p2
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x), L = 13, W = 6;
    const bx = p2.x - Math.cos(angle) * L, by = p2.y - Math.sin(angle) * L;
    const head = [`${p2.x},${p2.y}`, `${bx - Math.sin(angle)*W},${by + Math.cos(angle)*W}`, `${bx + Math.sin(angle)*W},${by - Math.cos(angle)*W}`].join(" ");
    const g = svgEl("g", { class: "b-link", "data-id": link.id });
    const line = { x1: p1.x, y1: p1.y, x2: bx, y2: by };
    g.append(svgEl("line", { ...line, class: "hit" }), svgEl("line", { ...line, class: "visible" }), svgEl("polygon", { points: head, class: "head" }));
    boardSvg.appendChild(g);
  }
  refreshSelection();
}

// ---- zapis do API -----------------------------------------------------------
async function saveItem(id, patch) {
  boardStatus.textContent = "Zapisywanie…";
  try { await api(`/api/board/items/${id}`, { method: "PUT", body: patch }); boardStatus.textContent = "Zapisano " + new Date().toLocaleTimeString("pl-PL"); }
  catch (err) { boardStatus.textContent = "Błąd zapisu!"; console.error(err); }
}

async function createItem(type, point) {
  const d = ITEM_DEFAULTS[type];
  try {
    const item = await api("/api/board/items", { method: "POST", body: {
      type, color: boardColor, text: "",
      x: Math.round(clamp(point.x - d.w / 2, -COORD_LIMIT, COORD_LIMIT)),
      y: Math.round(clamp(point.y - d.h / 2, -COORD_LIMIT, COORD_LIMIT)),
      w: d.w, h: d.h,
    }});
    board.items.push(item); setTool("select"); selected = { kind: "item", id: item.id };
    renderBoard(); refreshSelection(); startEdit(item.id);
  } catch (err) { showError(err); }
}

async function deleteItem(id) {
  try {
    await api(`/api/board/items/${id}`, { method: "DELETE" });
    board.items = board.items.filter((i) => i.id !== id);
    board.links = board.links.filter((l) => l.from_id !== id && l.to_id !== id);
    if (selected && selected.kind === "item" && selected.id === id) selected = null;
    renderBoard(); refreshSelection();
  } catch (err) { showError(err); }
}

async function deleteSelected() {
  if (!selected) return;
  if (selected.kind === "item") return deleteItem(selected.id);
  try {
    await api(`/api/board/links/${selected.id}`, { method: "DELETE" });
    board.links = board.links.filter((l) => l.id !== selected.id);
    selected = null; drawLinks();
  } catch (err) { showError(err); }
}

function bringToFront(item) {
  const top = Math.max(0, ...board.items.map((i) => i.z));
  if (item.z >= top) return;
  item.z = top + 1; paintItem(itemEl(item.id), item); saveItem(item.id, { z: item.z });
}

// ---- edycja tekstu w miejscu (textarea) --------------------------------------
// Ctrl+Enter lub utrata fokusu = zapis, Escape = anuluj. Pusty element typu "tekst" znika.
function startEdit(id) {
  const item = itemById(id), node = itemEl(id);
  if (!item || !node || editing !== null) return;
  editing = id;
  const area = el("textarea", { className: "b-edit", value: item.text, maxLength: 2000, placeholder: "Wpisz tekst…" });
  node.querySelector(".b-label").replaceWith(area);
  area.focus();
  let finished = false;
  const finish = (save) => {
    if (finished) return; finished = true;
    if (editing === id) editing = null;
    const value = area.value.trim();
    const label = el("div", { className: "b-label", textContent: save ? value : item.text });
    area.replaceWith(label);
    const current = itemById(id);
    if (!current) return;
    if (save && value !== current.text) { current.text = value; saveItem(id, { text: value }); }
    if (current.type === "text" && current.text === "") deleteItem(id);
    boardViewport.focus({ preventScroll: true });
  };
  area.addEventListener("keydown", (e) => { if (e.key === "Escape") finish(false); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) finish(true); });
  area.addEventListener("blur", () => finish(true));
}

// ---- narzędzia i kolory -----------------------------------------------------
function markLinkSource() {
  qAll(".b-item", boardWorld).forEach((node) => node.classList.toggle("link-source", linkSource === Number(node.dataset.id)));
}

function setTool(name) {
  tool = name; linkSource = null; markLinkSource();
  boardViewport.dataset.tool = name;
  boardHint.textContent = TOOL_HINTS[name];
  qAll("[data-tool]").forEach((b) => { if (b.classList.contains("tool")) b.classList.toggle("active", b.dataset.tool === name); });
}

qAll("button.tool").forEach((btn) => btn.addEventListener("click", () => setTool(btn.dataset.tool)));

qAll(".swatch").forEach((btn) => {
  btn.addEventListener("click", () => {
    boardColor = btn.dataset.color;
    qAll(".swatch").forEach((s) => s.classList.toggle("active", s === btn));
    // zaznaczony element (poza czystym tekstem) zmienia kolor od razu
    const item = selected && selected.kind === "item" ? itemById(selected.id) : null;
    if (item && item.type !== "text" && item.color !== boardColor) {
      item.color = boardColor; paintItem(itemEl(item.id), item); saveItem(item.id, { color: boardColor });
    }
  });
});

$("#board-zoom-in").addEventListener("click",  () => zoomCenter(1.25));
$("#board-zoom-out").addEventListener("click", () => zoomCenter(1 / 1.25));
$("#board-fit").addEventListener("click", fitView);
boardDeleteBtn.addEventListener("click", deleteSelected);

$("#board-clear").addEventListener("click", async () => {
  if (board.items.length === 0 || !confirm("Usunąć wszystkie elementy z tablicy?")) return;
  try { await api("/api/board", { method: "DELETE" }); board = { items: [], links: [] }; selected = null; renderBoard(); refreshSelection(); }
  catch (err) { showError(err); }
});
