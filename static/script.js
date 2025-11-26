document.getElementById('sendBtn').addEventListener('click', async () => {
    const txt = document.getElementById("userInput").value.trim();
    const area = document.getElementById("responseArea");
    if (!txt) { area.innerHTML = "<div class='meta'>Enter a question</div>"; return; }
    area.innerHTML = "<div class='meta'>Thinking...</div>";

    try {
      const res = await fetch("/api/query", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ text: txt })
      });
      const j = await res.json();
      if (j.error) {
          area.innerHTML = `<div class="meta">Error:</div><pre>${escapeHtml(j.details || j.error)}</pre>`;
          return;
      }
      area.innerHTML = `
          <div class="meta">Model Reply</div>
          <div class="formatted">${formatReply(j.reply)}</div>
      `;
    } catch (err) {
      area.innerHTML = `<div class="meta">Network error</div>`;
    }
});

function formatReply(text) {
    if (!text) return "";
    let s = escapeHtml(text);
    s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/[\n\r]+/g, "\n");
    const lines = s.split("\n");
    let html = "<p>";
    lines.forEach(line => {
        if (line.trim().startsWith("*")) {
            html += `</p><ul><li>${line.replace("*", "").trim()}</li></ul><p>`;
        } else {
            html += line + "<br>";
        }
    });
    return html + "</p>";
}

function escapeHtml(s) {
  if (!s) return "";
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
// navbar mobile toggle
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const shown = links.classList.toggle('show');
      toggle.setAttribute('aria-expanded', shown ? 'true' : 'false');
    });
    // close when clicking outside (mobile)
    document.addEventListener('click', (ev) => {
      if (!links.contains(ev.target) && !toggle.contains(ev.target) && links.classList.contains('show')) {
        links.classList.remove('show');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
});
