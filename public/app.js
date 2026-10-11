const form = document.querySelector("#research-form");
const queryInput = document.querySelector("#query");
const status = document.querySelector("#status");
const results = document.querySelector("#results");

document.querySelectorAll("[data-query]").forEach((button) => {
  button.addEventListener("click", () => { queryInput.value = button.dataset.query; queryInput.focus(); if (button.closest(".path-grid")) form.requestSubmit(); });
});

function escapeHtml(value = "") {
  return String(value).replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
}

function card(pick, index) {
  const list = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const why = list(pick.why).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const tradeoffs = list(pick.tradeoffs).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const sources = (pick.sources || []).filter((source) => source.url).map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.title || "Source")}</a>`).join(" · ");
  return `<article class="pick ${index === 0 ? "top" : ""}"><div class="pick-head"><span class="rank">0${index + 1}</span><span class="label">${escapeHtml(pick.label || "Recommended")}</span><span class="score">${escapeHtml(pick.score)}/10</span></div><h3>${escapeHtml(pick.name)}</h3><p class="price">${escapeHtml(pick.price || "Check current price on Amazon")}</p><div class="two-col"><div><h4>Why it fits</h4><ul>${why}</ul></div><div><h4>Tradeoffs</h4><ul>${tradeoffs}</ul></div></div><a class="amazon" href="${escapeHtml(pick.amazonUrl)}" target="_blank" rel="sponsored noopener">See current Amazon listing <span>↗</span></a>${sources ? `<p class="sources">Sources: ${sources}</p>` : ""}</article>`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;
  status.className = "status loading";
  status.textContent = "Researching current options and checking sources…";
  results.hidden = true;
  try {
    const response = await fetch("/api/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Research failed");
    status.className = "status success";
    status.textContent = "Your shortlist is ready.";
    const modeNote = data.provider === "curated-workspace-catalog" ? "These are curated product matches, not a paid placement. Verify current pricing, compatibility, reviews, and return terms before buying." : "";
    results.innerHTML = `<div class="result-intro"><p class="eyebrow">YOUR PICKS</p><h2>${escapeHtml(data.summary || "Three options worth considering")}</h2><p>${escapeHtml(data.budget_note || "Prices and availability can change; check Amazon for the latest details.")}</p>${modeNote ? `<p class="mode-note">${escapeHtml(modeNote)}</p>` : ""}</div><div class="pick-grid">${(data.picks || []).map(card).join("")}</div><p class="disclosure">${escapeHtml(data.affiliateDisclosure)}</p>`;
    results.hidden = false;
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    status.className = "status error";
    status.textContent = error.message;
  }
});
