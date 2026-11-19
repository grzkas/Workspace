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

