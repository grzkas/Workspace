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
