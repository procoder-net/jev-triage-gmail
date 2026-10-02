// The Jev Triage panel inside Gmail. Goes through your emails one after another:
// read the row → ask Jev (via the background worker) → apply labels with Gmail's own Labels menu.
(function () {
  if (window.__jevTriageLoaded) return;
  window.__jevTriageLoaded = true;

  const T = window.JEV_TAXONOMY;
  const UI = window.JevGmailUI;
  let tax = T.DEFAULTS;                       // replaced with saved Options edits at Start
  const actLabel = key => (T.byKey(tax.actions, key) || {}).label || key;
  const topLabel = key => (T.byKey(tax.topics, key) || {}).label || key;

  const SCOPES = {
    inbox: { name: 'Inbox', query: 'in:inbox' },
    all: { name: 'All mail', query: '-in:spam -in:trash -in:chats' },
    view: { name: 'Current page only', query: null },
  };

  let running = false;
  const doneThisRun = new Set();

  // ---------- panel ----------
  const pill = document.createElement('button');
  pill.id = 'jev-pill';
  pill.textContent = 'Jev';
  pill.title = 'Jev Triage';

  const panel = document.createElement('div');
  panel.id = 'jev-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="jev-head"><b>Jev Triage</b><span id="jev-me"></span><button id="jev-close" title="Hide">✕</button></div>
    <div class="jev-body">
      <label>Emails <select id="jev-scope">
        <option value="inbox">Inbox (not yet sorted)</option>
        <option value="all">All mail (not yet sorted)</option>
        <option value="view">Current page only</option>
      </select></label>
      <label class="jev-check"><input type="checkbox" id="jev-preview"> Preview only (don't add labels)</label>
      <label class="jev-check"><input type="checkbox" id="jev-deep"> Open each email to read the full text (slower, more accurate)</label>
      <div class="jev-row">
        <button id="jev-start" class="jev-primary">Start</button>
        <button id="jev-stop" disabled>Pause</button>
        <button id="jev-diag" title="Check that the extension can see your Gmail">Check</button>
      </div>
      <div class="jev-row">
        <button id="jev-learn" title="Look at your recent inbox and suggest rules for your senders">Learn my inbox</button>
        <select id="jev-learn-n" title="How many recent emails to look at"><option value="100">100 emails</option><option value="200" selected>200 emails</option><option value="400">400 emails</option></select>
      </div>
      <div id="jev-status">Ready.</div>
      <div id="jev-learned" hidden>
        <div class="jev-learn-head"><b>Suggested rules from your inbox</b> <span id="jev-learn-sum"></span></div>
        <ul id="jev-sugg"></ul>
        <div class="jev-row"><button id="jev-save-rules" class="jev-primary">Save selected</button><button id="jev-filters">Download Gmail filters</button></div>
      </div>
      <div id="jev-counts"></div>
      <ul id="jev-log"></ul>
    </div>`;
  document.documentElement.append(pill, panel);

  const $ = id => panel.querySelector('#' + id);
  pill.onclick = () => { panel.hidden = !panel.hidden; $('jev-me').textContent = UI.myEmail(); refreshCounts(); };
  $('jev-close').onclick = () => (panel.hidden = true);

  function status(msg, isErr) {
    $('jev-status').textContent = msg;
    $('jev-status').className = isErr ? 'jev-err' : '';
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function logItem(r, res, labelled) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="jev-subj">${esc(r.subject)}</span>
      <span class="jev-chip">${esc(actLabel(res.action).split('/').pop())}</span><span class="jev-chip">${esc(topLabel(res.topic).split('/').pop())}</span>${res.mustSee ? '<span class="jev-chip jev-must">Must see</span>' : ''}${res.archived ? '<span class="jev-chip jev-dim">archived</span>' : ''}${res.source === 'rule' ? '<span class="jev-chip jev-dim">rule</span>' : ''}${(res.skipped || []).map(l => `<span class="jev-chip jev-u" title="Gmail would not create this label">no label: ${esc(l.split('/').pop())}</span>`).join('')}${res.urgency >= 4 ? '<span class="jev-chip jev-u">Urgent</span>' : ''}${res.review ? '<span class="jev-chip">Review?</span>' : ''}${labelled ? '' : '<span class="jev-chip jev-dim">preview</span>'}`;
    $('jev-log').prepend(li);
    while ($('jev-log').children.length > 40) $('jev-log').lastChild.remove();
  }

  async function refreshCounts() {
    const { jevStats = { sorted: 0, byLabel: {} } } = await chrome.storage.local.get('jevStats');
    const actionNames = new Set(tax.actions.map(a => a.label));
    const top = Object.entries(jevStats.byLabel).filter(([l]) => actionNames.has(l)).sort((a, b) => b[1] - a[1]);
    $('jev-counts').textContent = jevStats.sorted
      ? `Labelled so far: ${jevStats.sorted} · ` + top.map(([l, n]) => `${l.split('/').pop()} ${n}`).join(' · ')
      : '';
  }

  async function addStats(labels) {
    const { jevStats = { sorted: 0, byLabel: {} } } = await chrome.storage.local.get('jevStats');
    jevStats.sorted++;
    for (const l of labels) jevStats.byLabel[l] = (jevStats.byLabel[l] || 0) + 1;
    await chrome.storage.local.set({ jevStats });
    refreshCounts();
  }

  // ---------- one email ----------
  async function askJev(r, body) {
    const text = [
      `From: ${r.fromName} <${r.fromEmail}>`,
      `Participants: ${r.participants.join(', ')}`,
      `Subject: ${r.subject}`,
      `Received: ${r.date}`,
      `Unread: ${r.unread ? 'yes' : 'no'}`,
      `Recipient has replied in this thread before: ${r.repliedBefore ? 'yes' : 'no'}`,
      '',
      'Body:',
      (body || r.snippet || '(empty)').replace(/https?:\/\/\S+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim().slice(0, 1500),
    ].join('\n');
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await chrome.runtime.sendMessage({ cmd: 'classify', text, fromEmail: r.fromEmail });
      if (res && res.rateLimited) { status('Jev is busy, waiting 30 s…'); await UI.sleep(30000); continue; }
      if (!res || res.error) throw new Error(res ? res.error : 'No answer from the extension background.');
      return res;
    }
    throw new Error('Jev kept rate-limiting. Try again later.');
  }

  async function handle(r, opts) {
    let body = '';
    if (opts.deep) {
      const row = UI.findRowById(r.id);
      if (row) body = await UI.readFullBody(row);
    }
    const res = await askJev(r, body);
    const action = actLabel(res.action);
    const labels = [topLabel(res.topic)];
    if (res.urgency >= 4) labels.push(tax.urgentLabel);
    if (res.review) labels.push(tax.reviewLabel);
    if (res.mustSee && tax.mustSeeLabel) labels.unshift(tax.mustSeeLabel);
    const archive = !!tax.archiveIgnored && (tax.ignoreActions || []).includes(res.action) && !res.mustSee;
    labels.push(action);                                    // action label last (see gmail-ui.js)

    if (!opts.preview) {
      const row = UI.findRowById(r.id);
      if (!row) throw new Error('Lost track of the email row (did the page change?).');
      await UI.setSelected(row, true);
      const applied = await UI.applyLabels(labels, action, { archive });
      res.skipped = (applied && applied.skipped) || [];
      res.archived = !!(applied && applied.archived);
      const again = UI.findRowById(r.id);
      if (again) await UI.setSelected(again, false).catch(() => {});
      await addStats([action, labels[0]]);
    }
    logItem(r, res, !opts.preview);
  }

  // ---------- the loop ----------
  async function run() {
    tax = await T.load();
    const scope = SCOPES[$('jev-scope').value];
    const opts = { preview: $('jev-preview').checked, deep: $('jev-deep').checked };
    running = true; doneThisRun.clear();
    $('jev-start').disabled = true; $('jev-stop').disabled = false;
    let handled = 0;
    try {
      while (running) {
        if (scope.query) {
          status('Loading ' + scope.name + '…');
          await UI.settle(2000);                              // let Gmail save before reloading the list
          UI.goToSearch(scope.query + ' ' + T.unsortedQuery(tax));
          const state = await UI.waitForList();
          if (state === 'empty') { status(`All done: nothing left to sort in ${scope.name}. (${handled} this run)`); break; }
          if (!state) throw new Error('Gmail list did not load.');
        }
        const rows = UI.listRows().map(UI.readRow).filter(r => !doneThisRun.has(r.id));
        if (!rows.length) {
          status(`Finished this page. ${handled} sorted this run.`);
          break;
        }
        const before = handled;
        for (const r of rows) {
          if (!running) break;
          status(`(${handled + 1}) ${r.subject.slice(0, 60)}`);
          try {
            await handle(r, opts);
          } catch (e) {
            if (!UI.dismissGmailError() && !/not showing|not visible|did not open|Lost track/.test(e.message)) throw e;
            status('Gmail hiccuped, waiting 8 s and retrying this email…');
            await UI.sleep(8000);
            const again = UI.findRowById(r.id);
            if (again) { for (const cb of UI.listRows()) await UI.setSelected(cb, false).catch(() => {}); await handle(r, opts); }
          }
          doneThisRun.add(r.id);
          handled++;
          if (opts.preview && handled >= 10) { running = false; status('Preview of 10 done. Untick "Preview only" to label.'); }
          if (!(await UI.settle(1500))) { status('Gmail showed an error; pausing 10 s…'); await UI.sleep(10000); }
        }
        if (!scope.query || opts.preview) { if (running) status(`Done. ${handled} emails.`); break; }
        if (handled === before) break;         // safety: nothing got done on this page
      }
    } catch (e) {
      status('Stopped: ' + e.message, true);
    } finally {
      running = false;
      $('jev-start').disabled = false; $('jev-stop').disabled = true;
    }
  }

  // ---------- Learn my inbox: suggest sender rules for THIS user ----------
  let suggestions = [];

  async function collectInboxRows(max) {
    const seen = new Map();
    for (let page = 1; seen.size < max && page <= 20; page++) {
      location.hash = page === 1 ? '#inbox' : '#inbox/p' + page;
      const state = await UI.waitForList();
      if (state !== 'rows') break;
      const before = seen.size;
      for (const r of UI.listRows().map(UI.readRow)) if (r.fromEmail && !seen.has(r.id)) seen.set(r.id, r);
      if (seen.size === before) break;                      // no new rows: last page
      await UI.sleep(800);
    }
    return [...seen.values()].slice(0, max);
  }

  function suggest(results) {
    const groups = new Map();
    for (const { r, res } of results) {
      const key = T.senderKey(r.fromEmail);
      if (!groups.has(key)) groups.set(key, { key, name: r.fromName, n: 0, actions: {}, topics: {}, must: 0 });
      const g = groups.get(key);
      g.n++; g.actions[res.action] = (g.actions[res.action] || 0) + 1; g.topics[res.topic] = (g.topics[res.topic] || 0) + 1;
      if (res.mustSee) g.must++;
    }
    const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const out = [];
    for (const g of groups.values()) {
      if (T.ruleFor(tax, g.key)) continue;                  // already has a rule
      const [action, aN] = top(g.actions), [topic] = top(g.topics);
      const steady = aN / g.n >= 0.7;
      const mustSee = g.must / g.n >= 0.5;
      if (g.n < 2 && !mustSee) continue;                    // one-off senders: let Jev decide each time
      out.push({ match: g.key, name: g.name, n: g.n, topic, action: steady && !mustSee ? action : undefined, mustSee: mustSee || undefined,
                 checked: g.n >= 2 && (steady || mustSee) });   // one-offs are shown but not pre-ticked
    }
    return out.sort((a, b) => (b.mustSee ? 1000 : 0) + b.n - ((a.mustSee ? 1000 : 0) + a.n));
  }

  function renderSuggestions() {
    $('jev-learned').hidden = false;
    const ignored = suggestions.filter(x => x.action && (tax.ignoreActions || []).includes(x.action)).length;
    $('jev-learn-sum').textContent = `${suggestions.length} senders · ${suggestions.filter(x => x.mustSee).length} must-see · ${ignored} to ignore`;
    $('jev-sugg').innerHTML = suggestions.map((x, i) => {
      const what = x.mustSee ? '<span class="jev-chip jev-must">Must see</span>'
        : x.action ? `<span class="jev-chip">${esc(actLabel(x.action).split('/').pop())}</span>` : '<span class="jev-chip jev-dim">Jev decides</span>';
      return `<li><label class="jev-check"><input type="checkbox" data-i="${i}" ${x.checked ? 'checked' : ''}>
        <span><b>${esc(x.match)}</b> <span class="jev-dim-t">${x.n} emails</span><br>${what}<span class="jev-chip">${esc(topLabel(x.topic).split('/').pop())}</span></span></label></li>`;
    }).join('') || '<li class="jev-dim-t">No new patterns found. Your existing rules already cover these senders.</li>';
  }

  async function learn() {
    tax = await T.load();
    const max = Number($('jev-learn-n').value);
    running = true; $('jev-learn').disabled = true; $('jev-start').disabled = true; $('jev-stop').disabled = false;
    try {
      status('Reading your inbox…');
      const rows = await collectInboxRows(max);
      const results = [];
      for (const r of rows) {
        if (!running) break;
        status(`Learning ${results.length + 1}/${rows.length}: ${r.subject.slice(0, 50)}`);
        results.push({ r, res: await askJev(r, '') });
      }
      suggestions = suggest(results);
      renderSuggestions();
      status(`Looked at ${results.length} emails. Review the suggestions, then Save. Nothing was labelled.`);
    } catch (e) {
      status('Stopped: ' + e.message, true);
    } finally {
      running = false; $('jev-learn').disabled = false; $('jev-start').disabled = false; $('jev-stop').disabled = true;
    }
  }

  $('jev-learn').onclick = learn;
  $('jev-save-rules').onclick = async () => {
    const picked = [...$('jev-sugg').querySelectorAll('input[type=checkbox]')].filter(c => c.checked).map(c => suggestions[Number(c.dataset.i)]);
    const saved = await T.load();
    for (const p of picked) {
      saved.rules = (saved.rules || []).filter(r => r.match !== p.match);
      saved.rules.push({ match: p.match, topic: p.topic, action: p.action, mustSee: p.mustSee });
    }
    await chrome.storage.local.set({ taxonomy: saved });
    tax = saved;
    status(`Saved ${picked.length} rules. They apply from the next email. Edit them any time in Options.`);
  };
  $('jev-filters').onclick = async () => {
    const t = await T.load();
    const blob = new Blob([T.filtersXml(t)], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'jev-gmail-filters.xml';
    document.body.append(a); a.click(); a.remove();
    status('Downloaded. Gmail ⚙ → See all settings → Filters and Blocked Addresses → Import filters.');
  };

  $('jev-start').onclick = run;
  $('jev-stop').onclick = () => { running = false; status('Pausing after this email…'); };
  $('jev-diag').onclick = async () => {
    const d = await UI.diagnose();
    status(`Account: ${d.email} · rows seen: ${d.rows} · checkbox: ${d.checkbox ? 'yes' : 'NO'} · Labels button: ${d.labelsButton ? 'yes' : 'NO'}` +
      (d.firstRow ? ` · first: "${d.firstRow.subject.slice(0, 40)}" from ${d.firstRow.fromEmail || '?'}` : ''), !(d.rows && d.checkbox && d.labelsButton));
  };
})();
