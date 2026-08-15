const form = document.querySelector('#scan-form');
const input = document.querySelector('#url-input');
const button = document.querySelector('#scan-button');
const errorBox = document.querySelector('#form-error');
const report = document.querySelector('#report');
const loadingTemplate = document.querySelector('#loading-template');

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function showLoading() {
  const panel = loadingTemplate.content.cloneNode(true);
  document.body.append(panel);
  const labels = ['Connecting to the website…', 'Inspecting page structure…', 'Checking crawl signals…', 'Prioritizing opportunities…'];
  let index = 0;
  const timer = setInterval(() => {
    const label = document.querySelector('#loading-label');
    if (label) label.textContent = labels[Math.min(++index, labels.length - 1)];
  }, 1300);
  return () => { clearInterval(timer); document.querySelector('.loading-panel')?.remove(); };
}

function renderPillars(pillars) {
  document.querySelector('#pillar-list').innerHTML = pillars.map((item) => `
    <div class="pillar">
      <div class="pillar-head"><span>${escapeHtml(item.label)}</span><b>${item.score}/100</b></div>
      <div class="bar"><span data-score="${item.score}"></span></div>
      <small>${escapeHtml(item.note)}</small>
    </div>`).join('');
  requestAnimationFrame(() => document.querySelectorAll('.bar span').forEach((bar) => { bar.style.width = `${bar.dataset.score}%`; }));
}

function renderReport(data) {
  document.querySelector('#report-domain').textContent = data.hostname;
  document.querySelector('#report-date').textContent = `Scanned ${new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(data.scannedAt))}`;
  document.querySelector('#overall-score').textContent = data.overall;
  document.querySelector('#score-ring').style.setProperty('--score', data.overall);
  document.querySelector('#grade').textContent = data.grade;
  document.querySelector('#summary').textContent = data.summary;
  renderPillars(data.pillars);

  const historyKey = `signalready:${data.hostname}`;
  const previous = Number(localStorage.getItem(historyKey));
  const scoreChange = document.querySelector('#score-change');
  if (Number.isFinite(previous) && previous > 0) {
    const delta = data.overall - previous;
    scoreChange.hidden = false;
    scoreChange.textContent = `${delta >= 0 ? '+' : ''}${delta} since last scan`;
  } else {
    scoreChange.hidden = true;
  }
  localStorage.setItem(historyKey, String(data.overall));

  const metrics = [
    [data.metrics.responseMs, 'Response ms'], [data.metrics.words.toLocaleString(), 'Visible words'],
    [data.metrics.headings, 'Headings'], [data.metrics.schemas, 'JSON-LD blocks'],
    [data.metrics.linksChecked, 'Links sampled'], [data.metrics.brokenLinks, 'Link failures']
  ];
  document.querySelector('#metric-grid').innerHTML = metrics.map(([value, label]) => `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');

  document.querySelector('#finding-count').textContent = `${data.findings.length} findings`;
  document.querySelector('#finding-list').innerHTML = data.findings.map((item) => `
    <article class="finding ${escapeHtml(item.severity)}">
      <span class="severity-dot"></span>
      <div>
        <h4>${escapeHtml(item.title)}</h4>
        <p><strong>Observed:</strong> ${escapeHtml(item.observed || item.detail)}</p>
        <div class="finding-meta"><span>${escapeHtml(item.affected || '')}</span><span>${escapeHtml(item.confidence || 'High')} confidence</span><span>${escapeHtml(item.scoreImpact || '')}</span><span>${escapeHtml(item.effort || '')} effort</span></div>
        <p><strong>Potential impact:</strong> ${escapeHtml(item.impact || '')}</p>
        <details><summary>Evidence & recommended action</summary>
          <div class="evidence-list">${(item.evidence || []).map((evidence) => `<div class="evidence-row"><b>${escapeHtml(evidence.url)}</b>${escapeHtml(evidence.detail)}</div>`).join('')}</div>
          <p><strong>Action:</strong> ${escapeHtml(item.action)}</p>
          <p><strong>Owner:</strong> ${escapeHtml(item.owner || 'Web team')} · ${escapeHtml(item.phase || '')}</p>
        </details>
      </div>
      <span class="tag">${escapeHtml(item.severity)}</span>
    </article>`).join('');
  const strengths = data.strengths.length ? data.strengths : ['A baseline scan is complete and ready to guide remediation.'];
  document.querySelector('#strength-list').innerHTML = strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  document.querySelector('#scan-scope').textContent = data.scope;

  document.querySelector('#coverage-note').textContent = data.coverage.note;
  document.querySelector('#page-list').innerHTML = data.coverage.pageUrls.map((url, index) => `<div class="page-row"><span>${index + 1}</span><span title="${escapeHtml(url)}">${escapeHtml(url)}</span></div>`).join('');
  document.querySelector('#bot-list').innerHTML = data.aiBots.map((bot) => `<div class="bot-row"><strong>${escapeHtml(bot.name)}</strong><span class="status-pill ${escapeHtml(bot.status)}">${escapeHtml(bot.status)}</span></div>`).join('');
  document.querySelector('#methodology-copy').textContent = data.methodology;
  document.querySelector('#score-method').innerHTML = data.pillars.map((pillar) => `
    <article class="method-score-card">
      <div class="method-score-head"><h4>${escapeHtml(pillar.label)}</h4><b>${pillar.score}/100</b></div>
      ${pillar.checks.map((check) => `<div class="check-row"><span>${escapeHtml(check.label)}</span><b>${check.earned}/${check.max}</b><small>${escapeHtml(check.evidence)}</small></div>`).join('')}
    </article>`).join('');
  document.querySelector('#roadmap').innerHTML = data.roadmap.length ? data.roadmap.map((group) => `
    <div class="roadmap-column"><span>${escapeHtml(group.phase)}</span>${group.actions.map((action) => `<div class="roadmap-action"><h4>${escapeHtml(action.title)}</h4><p>${escapeHtml(action.owner)} · ${escapeHtml(action.effort)} effort</p></div>`).join('')}</div>`).join('') : '<p>No remediation actions were generated for this sample.</p>';
  document.querySelector('#validation-list').innerHTML = data.validations.map((item) => `<div class="validation-row"><strong>${escapeHtml(item.name)}</strong><span class="status-pill ${escapeHtml(item.status.toLowerCase().replace(' ', '-'))}">${escapeHtml(item.status)}</span><span>${escapeHtml(item.detail)}</span></div>`).join('');
  const highPriority = data.findings.filter((item) => item.severity === 'high').length;
  document.querySelector('#conversion-copy').textContent = `This sample surfaced ${data.findings.length} prioritized opportunities${highPriority ? `, including ${highPriority} high-priority ${highPriority === 1 ? 'issue' : 'issues'}` : ''}. A full audit validates the pattern site-wide and gives every action an owner, sequence, and implementation brief.`;

  report.hidden = false;
  setTimeout(() => report.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  button.disabled = true;
  const stopLoading = showLoading();
  try {
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: input.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The scan could not be completed.');
    renderReport(data);
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    stopLoading();
    button.disabled = false;
  }
});

document.querySelector('#print-button').addEventListener('click', () => window.print());
