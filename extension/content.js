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
        <option value="all" selected>All mail (skips anything already sorted)</option>
        <option value="inbox">Inbox only (skips anything already sorted)</option>
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

  async function addStats(labels, count = 1) {
    const { jevStats = { sorted: 0, byLabel: {} } } = await chrome.storage.local.get('jevStats');
    jevStats.sorted += count;
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

  const JEV_PARALLEL = 4;     // Jev calls in flight at once
  const BATCH = 25;           // emails classified before labelling them as groups

  /** Run fn over items, at most n at a time. Returns [{ok, value|error}] in input order. */
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length && running) {
        const i = next++;
        try { out[i] = { ok: true, value: await fn(items[i], i) }; }
        catch (e) { out[i] = { ok: false, error: e }; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return out;
  }

  /** Ask Jev (or a sender rule) about one email and work out its labels. No clicking. */
  async function plan(r, body) {
    const res = await askJev(r, body);
    const action = actLabel(res.action);
    const labels = [topLabel(res.topic)];
    if (res.urgency >= 4) labels.push(tax.urgentLabel);
    if (res.review) labels.push(tax.reviewLabel);
    if (res.mustSee && tax.mustSeeLabel) labels.unshift(tax.mustSeeLabel);
    const archive = !!tax.archiveIgnored && (tax.ignoreActions || []).includes(res.action) && !res.mustSee;
    labels.push(action);                                    // action label last (see gmail-ui.js)
    return { r, res, labels, action, archive, key: labels.join('|') + (archive ? '|archive' : '') };
  }

  /** Label every email in a group (same labels) with one pass through Gmail's menus. */
  async function applyGroup(group) {
    await UI.clearSelection();
    const rows = group.map(p => UI.findRowById(p.r.id)).filter(Boolean);
    if (!rows.length) throw new Error('Lost track of the email rows (did the page change?).');
    for (const row of rows) await UI.setSelected(row, true);
    const { labels, action, archive } = group[0];
    const applied = await UI.applyLabels(labels, action, { archive });
    await UI.clearSelection();
    const found = new Set(rows.map(row => UI.readRow(row).id));
    return { applied, found };
  }

  // ---------- the loop ----------
  // Thread ids this browser has already sorted. Gmail's search index can lag a few seconds
  // behind a label change, so labelled emails may still show up briefly; this list stops us
  // re-doing them. The label itself is the real record (the search skips labelled mail).
  async function loadDone() {
    const { jevDone = [] } = await chrome.storage.local.get('jevDone');
    return new Set(jevDone);
  }
  async function saveDone(done) {
    const list = [...done];
    await chrome.storage.local.set({ jevDone: list.slice(-50000) });
  }

  async function run() {
    tax = await T.load();
    const scope = SCOPES[$('jev-scope').value];
    const opts = { preview: $('jev-preview').checked, deep: $('jev-deep').checked };
    const done = opts.preview ? new Set() : await loadDone();
    running = true; doneThisRun.clear();
    $('jev-start').disabled = true; $('jev-stop').disabled = false;
    let handled = 0, failed = 0, failStreak = 0, page = 1, idleReloads = 0, advancedPastSorted = false;
    const query = scope.query ? scope.query + ' ' + T.unsortedQuery(tax) : null;
    try {
      while (running) {
        if (query) {
          status(`Loading ${scope.name}${page > 1 ? ', page ' + page : ''}… (${handled} sorted so far)`);
          await UI.settle(1500);                              // let Gmail save before reloading the list
          UI.goToSearch(query, page);
          const state = await UI.waitForList();
          if (!state) throw new Error('Gmail list did not load. Check your connection and press Start again.');
          if (state === 'empty') {
            // Nothing past the sorted/skipped emails on the previous page: we're finished.
            if (page > 1 && !advancedPastSorted) { page = 1; continue; }   // pages shifted: re-check page 1
            status(`All done: nothing left to sort in ${scope.name}. ${handled} sorted this run${failed ? `, ${failed} skipped (they'll be retried next time)` : ''}.`);
            break;
          }
        }
        const visible = UI.listRows().map(UI.readRow);
        const rows = visible.filter(r => !doneThisRun.has(r.id) && !done.has(r.id));
        if (!rows.length) {
          if (!query) { status(`Done. ${handled} emails.`); break; }
          // Everything on screen is already sorted: either Gmail's search hasn't caught up yet,
          // or the remaining unsorted mail is on a later page.
          if (idleReloads < 2) { idleReloads++; status('Waiting for Gmail to catch up…'); await UI.sleep(4000); continue; }
          idleReloads = 0; page++; advancedPastSorted = true;
          if (page > 200) { status(`Stopped after 200 pages. ${handled} sorted.`); break; }
          continue;
        }
        idleReloads = 0; advancedPastSorted = false;
        const batch = rows.slice(0, opts.preview ? 10 - handled : BATCH);

        // 1) Full text (optional, needs the page, so one at a time), then Jev in parallel.
        const bodies = new Map();
        if (opts.deep) for (const r of batch) {
          if (!running) break;
          status(`Reading ${bodies.size + 1}/${batch.length}: ${r.subject.slice(0, 50)}`);
          const row = UI.findRowById(r.id);
          bodies.set(r.id, row ? await UI.readFullBody(row).catch(() => '') : '');
        }
        let asked = 0;
        status(`Asking Jev about ${batch.length} emails… (${handled} sorted so far)`);
        const results = await pool(batch, JEV_PARALLEL, async r => {
          const p = await plan(r, bodies.get(r.id));
          status(`Jev answered ${++asked}/${batch.length}… (${handled} sorted so far)`);
          return p;
        });
        if (!running) break;
        const plans = [];
        results.forEach((x, i) => {
          if (!x) return;
          if (x.ok) plans.push(x.value);
          else { failed++; logSkip(batch[i], x.error.message); doneThisRun.add(batch[i].id); }
        });
        if (results.length && results.every(x => x && !x.ok)) {
          failStreak++;
          if (failStreak >= 5) throw new Error('Jev failed 5 times in a row. Last error: ' + results[0].error.message);
          await UI.sleep(3000);
        }

        if (opts.preview) {
          for (const p of plans) { logItem(p.r, p.res, false); handled++; }
          running = false; status('Preview of 10 done. Untick "Preview only" to label.');
          break;
        }

        // 2) Group emails that get exactly the same labels and label each group in one go.
        const groups = new Map();
        for (const p of plans) (groups.get(p.key) || groups.set(p.key, []).get(p.key)).push(p);
        let g = 0;
        for (const group of groups.values()) {
          if (!running) break;
          g++;
          status(`Labelling group ${g}/${groups.size}: ${group.length} × ${group[0].action.split('/').pop()} (${handled} sorted so far)`);
          try {
            const { applied, found } = await applyGroup(group);
            failStreak = 0;
            for (const p of group) {
              doneThisRun.add(p.r.id);
              if (!found.has(p.r.id)) { failed++; logSkip(p.r, 'row was gone before labelling'); continue; }
              p.res.skipped = (applied && applied.skipped) || [];
              p.res.archived = !!(applied && applied.archived);
              done.add(p.r.id); handled++;
              logItem(p.r, p.res, true);
            }
            await addStats(group.filter(p => found.has(p.r.id)).flatMap(p => [p.action, p.labels[0]]), group.filter(p => found.has(p.r.id)).length);
            await saveDone(done);
          } catch (e) {
            // One bad group shouldn't end the run: dismiss Gmail's error, clear the selection, move on.
            UI.dismissGmailError();
            await UI.clearSelection();
            failStreak++;
            for (const p of group) { failed++; doneThisRun.add(p.r.id); logSkip(p.r, e.message); }
            if (failStreak >= 5) throw new Error('5 label attempts in a row failed. Last error: ' + e.message);
            await UI.sleep(3000);
          }
          if (!(await UI.settle(800))) { status('Gmail showed an error; pausing 10 s…'); await UI.sleep(10000); }
        }
        if (!query || opts.preview) { if (running) status(`Done. ${handled} emails.`); break; }
      }
      if (!running && !/All done|Preview/.test($('jev-status').textContent)) status(`Paused. ${handled} sorted this run. Press Start to continue where it left off.`);
    } catch (e) {
      status('Stopped: ' + e.message + ` (${handled} sorted). Press Start to continue.`, true);
    } finally {
      if (!opts.preview) await saveDone(done);
      running = false;
      $('jev-start').disabled = false; $('jev-stop').disabled = true;
    }
  }

  function logSkip(r, msg) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="jev-subj">${esc(r.subject)}</span><span class="jev-chip jev-u" title="${esc(msg)}">skipped: ${esc(msg.slice(0, 60))}</span>`;
    $('jev-log').prepend(li);
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
      let n = 0;
      const answers = await pool(rows, JEV_PARALLEL, async r => {
        const res = await askJev(r, '');
        status(`Learning ${++n}/${rows.length}…`);
        return { r, res };
      });
      const keyError = answers.find(x => x && !x.ok && /API key/.test(x.error.message));
      if (keyError) throw keyError.error;
      const results = answers.filter(x => x && x.ok).map(x => x.value);   // one odd email shouldn't stop learning
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
