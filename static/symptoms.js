/* same content as your previous symptoms.js (kept unchanged) */
const limitForChart = 12;
const el = id => document.getElementById(id);

el("symptomSeverity").addEventListener("input", (e) => {
  el("sevVal").textContent = e.target.value;
});

el("addSymptomBtn").addEventListener("click", async () => {
  const name = el("symptomName").value.trim();
  const severity = el("symptomSeverity").value;
  const notes = el("symptomNotes").value.trim();
  if (!name) { alert("Enter symptom name"); return; }

  try {
    const res = await fetch("/api/symptoms/add", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ name, severity, notes })
    });
    const j = await res.json();
    if (j.error) { alert(j.error); return; }
    el("symptomName").value = ""; el("symptomNotes").value = "";
    loadSymptoms();
  } catch (err) {
    alert("Network error");
  }
});

let chart = null;
async function loadSymptoms() {
  const res = await fetch("/api/symptoms/list");
  const items = await res.json();

  const list = el("symptomList");
  if (!items.length) {
    list.innerHTML = "<p class='muted'>No symptoms logged yet.</p>";
  } else {
    list.innerHTML = items.map(it => `
      <div class="symptom-card">
        <div class="symptom-row">
          <strong>${escapeHtml(it.name)}</strong>
          <div class="sev-pill">Severity: ${it.severity}/10</div>
        </div>
        <div class="muted small">${it.date_added}</div>
        <div>${escapeHtml(it.notes || "")}</div>
        <div class="row" style="margin-top:8px;">
          <button class="delete-btn" data-id="${it.id}">Delete</button>
        </div>
      </div>
    `).join("");
    list.querySelectorAll(".delete-btn").forEach(b => {
      b.addEventListener("click", async () => {
        const id = b.dataset.id;
        if (!confirm("Delete this entry?")) return;
        await fetch(`/api/symptoms/delete/${id}`, {method: "DELETE"});
        loadSymptoms();
      });
    });
  }

  const last = items.slice(0, limitForChart).reverse();
  const labels = last.map(i => i.date_added.split(" ")[0] + " " + i.date_added.split(" ")[1].slice(0,5));
  const data = last.map(i => Number(i.severity));

  if (!chart) {
    const ctx = document.getElementById("severityChart").getContext("2d");
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Severity',
          data,
          fill: true,
          tension: 0.25,
        }]
      },
      options: {
        scales: {
          y: { beginAtZero: true, suggestedMax: 10, ticks: { stepSize: 1 } }
        },
        plugins: { legend: { display: false } }
      }
    });
  } else {
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update();
  }
}

loadSymptoms();

el("analyzeBtn").addEventListener("click", async () => {
  el("analysisCard").style.display = "block";
  document.getElementById("analysisCard").scrollIntoView({ behavior: "smooth" });
  el("analysisResult").innerHTML = "<div class='meta'>Analyzing...</div>";

  try {
    const res = await fetch("/api/symptoms/analyze", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ limit: 12 })
    });
    const j = await res.json();
    if (j.error) {
      el("analysisResult").innerHTML = `<div class="meta">Error: ${escapeHtml(j.error)}</div>`;
      return;
    }
    el("analysisResult").innerHTML = formatText(j.reply || "");
  } catch (err) {
    el("analysisResult").innerHTML = `<div class="meta">Network error</div>`;
  }
});

el("exportBtn").addEventListener("click", () => {
  window.location = "/api/symptoms/export";
});

function escapeHtml(s) {
  if (!s) return "";
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatText(raw) {
  if (!raw) return "";
  let s = escapeHtml(raw);
  s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\n\s*[-*]\s+/g, "\n• ");
  const parts = s.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`);
  return parts.join("");
}
