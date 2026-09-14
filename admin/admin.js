const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="admin-token"]').content;
let entries = { articles: [], deleted: [] };
let selected = null;
let dirty = false;
let running = false;
let configured = false;
let jobWasRunning = false;
let loadingId = null;
function message(text, error = false) {
  $("message").textContent = text;
  $("message").className = error ? "error" : "success";
}
async function api(url, body) {
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Token": token,
          },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Vorgang fehlgeschlagen.");
  return data;
}
function markDirty(value) {
  dirty = value;
  $("dirty").textContent = dirty ? "Ungespeicherte Änderungen" : "";
}
function mayLeave() {
  return !dirty || confirm("Ungespeicherte Änderungen verwerfen?");
}
function setBusy() {
  document.querySelectorAll("[data-job]").forEach((button) => {
    button.disabled =
      running ||
      (["newest", "all"].includes(button.dataset.job) && !configured);
  });
  $("editor")
    .querySelectorAll("button,input,textarea,select")
    .forEach((control) => {
      control.disabled = running;
    });
}
function date(value) {
  return new Date(value).toLocaleDateString("de-DE");
}
function drawList() {
  const filter = $("filter").value;
  const needle = $("search").value.toLocaleLowerCase();
  const trash = filter === "trash";
  const items = (trash ? entries.deleted : entries.articles).filter(
    (article) => {
      const status =
        article.draft || article.needsReview ? "draft" : "published";
      return (
        (trash || filter === "all" || filter === status) &&
        `${article.title} ${article.id}`.toLocaleLowerCase().includes(needle)
      );
    },
  );
  $("count").textContent =
    `${items.length} ${trash ? "gelöschte" : "vorhandene"} Artikel`;
  $("list").replaceChildren();
  for (const article of items) {
    const card = document.createElement("div");
    card.className = "article-item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "article-select";
    button.setAttribute("aria-pressed", String(selected?.id === article.id));
    const title = document.createElement("strong");
    title.textContent = article.title;
    const info = document.createElement("span");
    info.textContent = trash
      ? `Gelöscht am ${date(article.deletedAt)} · Als Entwurf wiederherstellen`
      : `${date(article.publishedAt)} · ${article.needsReview ? "Prüfung nötig" : article.draft ? "Entwurf" : "Veröffentlicht"}${article.demo ? " · Demo" : ""}`;
    button.append(title, info);
    button.onclick = () =>
      trash ? restore(article.id) : openArticle(article.id);
    card.append(button);
    $("list").append(card);
  }
  if (!items.length) {
    const empty = document.createElement("p");
    empty.textContent = "Keine Artikel in dieser Auswahl.";
    $("list").append(empty);
  }
}
async function refreshList() {
  entries = await api("/api/articles");
  drawList();
}
async function openArticle(id, skipConfirm = false) {
  if (!skipConfirm && !mayLeave()) return;
  loadingId = id;
  try {
    const article = await api(`/api/article?id=${encodeURIComponent(id)}`);
    if (loadingId === id) fill(article);
  } catch (error) {
    message(error.message, true);
  }
}
function fill(article) {
  selected = article;
  $("editor").hidden = false;
  $("empty").hidden = true;
  for (const field of ["title", "description", "summary"])
    $(field).value = article.data[field];
  $("body").value = article.body;
  $("tags").value = article.data.tags.join(", ");
  $("publication").value = article.data.draft ? "draft" : "published";
  $("reviewed").checked = !article.data.generation.needsReview;
  $("original").href = article.data.instagram.permalink;
  $("provenance").textContent =
    `Instagram-ID ${article.id} · Veröffentlicht ${date(article.data.publishedAt)} · Bearbeitet ${date(article.data.updatedAt)}`;
  $("caption").textContent = article.caption || "Kein Quelltext gespeichert.";
  $("warnings").replaceChildren();
  for (const warning of article.data.generation.warnings.length
    ? article.data.generation.warnings
    : ["Keine Prüfhinweise."]) {
    const item = document.createElement("li");
    item.textContent = warning;
    $("warnings").append(item);
  }
  $("images").replaceChildren();
  article.data.images.forEach((image, index) => {
    const row = document.createElement("div");
    row.className = "image-row";
    const preview = document.createElement("img");
    preview.src = image.smallSrc;
    preview.alt = image.alt;
    preview.loading = "lazy";
    const label = document.createElement("label");
    label.textContent = `Bild ${index + 1}: Alternativtext`;
    const input = document.createElement("textarea");
    input.value = image.alt;
    input.maxLength = 300;
    input.required = true;
    input.rows = 3;
    input.dataset.alt = String(index);
    label.append(input);
    row.append(preview, label);
    $("images").append(row);
  });
  markDirty(false);
  drawList();
  setBusy();
}
$("editor").addEventListener("input", () => markDirty(true));
$("editor").onsubmit = async (event) => {
  event.preventDefault();
  if (running || !selected) return;
  if ($("publication").value === "published" && !$("reviewed").checked) {
    message(
      "Bitte die redaktionelle Prüfung bestätigen oder als Entwurf speichern.",
      true,
    );
    return;
  }
  const payload = {
    id: selected.id,
    revision: selected.revision,
    title: $("title").value,
    description: $("description").value,
    summary: $("summary").value,
    body: $("body").value,
    tags: $("tags")
      .value.split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    altTexts: [...document.querySelectorAll("[data-alt]")].map(
      (input) => input.value,
    ),
    draft: $("publication").value === "draft",
    reviewed: $("reviewed").checked,
  };
  running = true;
  setBusy();
  try {
    fill(await api("/api/save", payload));
    await refreshList();
    message(
      "Gespeichert. Für die öffentliche Website anschließend bauen und deployen.",
    );
  } catch (error) {
    message(error.message, true);
  } finally {
    running = false;
    setBusy();
  }
};
$("reload").onclick = () => selected && openArticle(selected.id);
$("delete").onclick = async () => {
  if (
    !selected ||
    running ||
    !confirm(
      `„${selected.data.title}“ in den Papierkorb verschieben? Der Artikel wird beim nächsten Build entfernt und nicht erneut importiert.${dirty ? " Ungespeicherte Änderungen gehen verloren." : ""}`,
    )
  )
    return;
  running = true;
  setBusy();
  try {
    await api("/api/delete", { id: selected.id, revision: selected.revision });
    selected = null;
    markDirty(false);
    $("editor").hidden = true;
    $("empty").hidden = false;
    await refreshList();
    message(
      "Im Papierkorb. Du kannst den Artikel dort als Entwurf wiederherstellen.",
    );
  } catch (error) {
    message(error.message, true);
  } finally {
    running = false;
    setBusy();
  }
};
async function restore(id) {
  if (running || !mayLeave()) return;
  running = true;
  setBusy();
  try {
    await api("/api/restore", { id });
    markDirty(false);
    $("filter").value = "all";
    await refreshList();
    await openArticle(id, true);
    message("Als Entwurf wiederhergestellt.");
  } catch (error) {
    message(error.message, true);
  } finally {
    running = false;
    setBusy();
  }
}
document.querySelectorAll("[data-job]").forEach((button) => {
  button.onclick = async () => {
    if (running || !mayLeave()) return;
    if (
      button.dataset.job === "all" &&
      !confirm(
        "Alle verfügbaren Instagram-Seiten nach fehlenden Beiträgen durchsuchen? Neue Artikel verwenden Gemini und können API-Kosten verursachen.",
      )
    )
      return;
    if (dirty && selected) await openArticle(selected.id, true);
    running = true;
    setBusy();
    try {
      await api("/api/job", { action: button.dataset.job });
      jobWasRunning = true;
      await poll();
    } catch (error) {
      running = false;
      jobWasRunning = false;
      setBusy();
      message(error.message, true);
    }
  };
});
let previousJob = "";
async function poll() {
  try {
    const status = await api("/api/status");
    configured = status.configured;
    $("connection").textContent = configured
      ? `Instagram und Gemini konfiguriert. Neue Artikel: ${status.autoPublish ? "automatisch veröffentlichen, wenn geprüft" : "als Entwürfe speichern"}.`
      : "Für echte Importe: Instagram- und Gemini-Zugangsdaten in .env eintragen und den Admin neu starten. Demo-Import und Artikelverwaltung funktionieren ohne Zugangsdaten.";
    if (status.job) {
      $("job").hidden = false;
      $("job-title").textContent =
        `${{ newest: "Neuesten Beitrag holen", all: "Alle fehlenden importieren", fixture: "Demo-Import", build: "Website bauen" }[status.job.action]} · ${status.job.running ? "läuft …" : status.job.exitCode === 0 ? "fertig" : "mit Fehler beendet"}`;
      $("job-log").textContent = status.job.log || "Vorgang startet …";
      const key = JSON.stringify(status.job);
      if (!status.job.running && key !== previousJob) await refreshList();
      previousJob = key;
    }
    // Do not unlock an in-flight save merely because there is no background job.
    if (status.job?.running) running = true;
    else if (jobWasRunning) running = false;
    jobWasRunning = Boolean(status.job?.running);
    setBusy();
  } catch (error) {
    message(`Admin nicht erreichbar: ${error.message}`, true);
  }
}
$("search").oninput = drawList;
$("filter").onchange = drawList;
window.addEventListener("beforeunload", (event) => {
  if (dirty) event.preventDefault();
});
refreshList().catch((error) => message(error.message, true));
poll();
setInterval(poll, 2000);
