// Drives the Gmail web page the way you would by hand: read the rows in the list,
// select one, open Gmail's "Labels" menu, pick labels, Apply.
// Gmail's page structure isn't a public API. If Google changes it, fix the selectors in SEL below.
(function (root) {
  const SEL = {
    main: 'div[role="main"]',
    row: 'tr.zA',
    unread: 'zE',                                         // class on unread rows
    sender: 'span[email]',                                // sender/participants carry an email attribute
    subject: '.bog',
    snippet: '.y2',
    date: 'td.xW span[title], td.xW span',
    checkbox: 'div[role="checkbox"]',
    threadId: '[data-legacy-thread-id], [data-thread-id]',
    labelsButton: 'div[role="button"][aria-label="Labels"], div[role="button"][data-tooltip="Labels"], div[role="button"][aria-label="Label as"]',
    moveButton: 'div[role="button"][aria-label="Move to"], div[role="button"][data-tooltip="Move to"]',
    menu: 'div[role="menu"]',
    menuInput: 'input',
    menuItem: '[role="menuitemcheckbox"], [role="menuitem"]',
    dialogButton: 'div[role="dialog"] button, div[role="alertdialog"] button, div[role="dialog"] [role="button"]',
    body: 'div.a3s',
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => !!el && el.offsetParent !== null && el.getClientRects().length > 0;

  async function waitFor(fn, timeout = 8000, step = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  function realClick(el) {
    if (!el) throw new Error('Tried to click something Gmail is not showing right now.');
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function typeInto(input, text) {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: text.slice(-1) || 'a' }));
  }

  function mainArea() {
    return [...document.querySelectorAll(SEL.main)].find(visible) || null;
  }

  function myEmail() {
    const m = document.title.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    return m ? m[0].toLowerCase() : '';
  }

  function listRows() {
    const main = mainArea();
    if (!main) return [];
    return [...main.querySelectorAll(SEL.row)].filter(visible);
  }

  function rowId(row) {
    const el = row.querySelector(SEL.threadId);
    if (el) return el.getAttribute('data-legacy-thread-id') || el.getAttribute('data-thread-id');
    return (row.querySelector(SEL.subject)?.innerText || '') + '|' + (row.querySelector(SEL.date)?.getAttribute('title') || '');
  }

  function readRow(row) {
    const senders = [...row.querySelectorAll(SEL.sender)];
    const first = senders[senders.length - 1] || senders[0];   // latest participant is usually last
    const me = myEmail();
    const dateEl = row.querySelector(SEL.date);
    return {
      id: rowId(row),
      fromName: first?.getAttribute('name') || first?.innerText || '',
      fromEmail: (first?.getAttribute('email') || '').toLowerCase(),
      participants: senders.map(s => s.getAttribute('email')).filter(Boolean),
      subject: row.querySelector(SEL.subject)?.innerText.trim() || '(no subject)',
      snippet: (row.querySelector(SEL.snippet)?.innerText || '').replace(/^\s*-\s*/, '').trim(),
      date: dateEl?.getAttribute('title') || dateEl?.innerText || '',
      unread: row.classList.contains(SEL.unread),
      repliedBefore: senders.some(s => (s.getAttribute('email') || '').toLowerCase() === me),
    };
  }

  /** Open the conversation, read the full text of the latest message, go back to the list. */
  async function readFullBody(row) {
    const listHash = location.hash;
    realClick(row.querySelector(SEL.subject) || row);
    const bodies = await waitFor(() => {
      const b = [...document.querySelectorAll(SEL.body)].filter(visible);
      return b.length ? b : null;
    }, 8000);
    const text = bodies ? bodies[bodies.length - 1].innerText : '';
    location.hash = listHash;
    await waitFor(() => listRows().length > 0, 8000);
    return text;
  }

  function findRowById(id) {
    return listRows().find(r => rowId(r) === id) || null;
  }

  function isChecked(row) {
    const cb = row.querySelector(SEL.checkbox);
    return cb && cb.getAttribute('aria-checked') === 'true';
  }

  async function setSelected(row, on) {
    const cb = row.querySelector(SEL.checkbox);
    if (!cb) throw new Error('Could not find the row checkbox.');
    if (isChecked(row) !== on) realClick(cb);
    await waitFor(() => isChecked(row) === on, 2000, 80);
  }

  function openMenu() {
    return [...document.querySelectorAll(SEL.menu)].find(m => visible(m) && m.querySelector(SEL.menuInput)) || null;
  }

  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  const NOT_A_LABEL = /create new|manage labels|^apply$/i;

  /** After typing a label name into the Labels menu, find that label's checkbox item.
   *  Gmail may show a nested label as "Topic/Investing", as just "Investing", or with the
   *  full name only in a title/aria-label, so accept any of those. */
  function findLabelItem(menu, name) {
    const full = norm(name);
    const leaf = norm(name.split('/').pop());
    const items = [...menu.querySelectorAll(SEL.menuItem)]
      .filter(i => visible(i) && !NOT_A_LABEL.test(norm(i.innerText)));
    const texts = i => [i.getAttribute('title'), i.getAttribute('aria-label'), i.innerText].map(norm).filter(Boolean);
    return items.find(i => texts(i).some(t => t === full))
      || items.find(i => texts(i).some(t => t.endsWith('/' + leaf) || t === leaf))
      || items.find(i => texts(i).some(t => t.includes(full)))
      || (items.length === 1 ? items[0] : null);        // the filter narrowed it to one label
  }

  /** Gmail's "Oops, something went wrong" box. Returns true if it was showing (and clicks OK). */
  function dismissGmailError() {
    const dlg = [...document.querySelectorAll('div[role="alertdialog"], div[role="dialog"]')]
      .find(d => visible(d) && /something went wrong|may not have been saved/i.test(d.innerText));
    if (!dlg) return false;
    const ok = [...dlg.querySelectorAll('button, [role="button"]')].find(b => /^ok$/i.test((b.innerText || '').trim()));
    if (ok) realClick(ok);
    return true;
  }

  /** Wait until Gmail has finished saving (no "Saving…"/"Loading…" banner, no error box). */
  async function settle(ms = 1200) {
    await sleep(ms);
    await waitFor(() => !/^(saving|loading|working)/i.test((document.querySelector('[role="alert"]')?.innerText || '').trim()), 6000, 200);
    return !dismissGmailError();
  }

  function labelsButton() {
    return [...document.querySelectorAll(SEL.labelsButton)].find(visible) || null;
  }

  async function openLabelsMenu() {
    const btn = await waitFor(labelsButton, 4000);       // Gmail shows it a moment after a tick
    if (!btn) throw new Error('Gmail\'s "Labels" button is not visible (is an email still selected? is Gmail in English?).');
    realClick(btn);
    const menu = await waitFor(openMenu, 4000);
    if (!menu) throw new Error('The Labels menu did not open.');
    return menu;
  }

  async function closeLabelsMenu(menu, apply) {
    const input = menu.querySelector(SEL.menuInput);
    typeInto(input, '');
    await sleep(200);
    const applyItem = [...menu.querySelectorAll(SEL.menuItem)].find(i => visible(i) && norm(i.innerText) === 'apply');
    if (apply && applyItem) realClick(applyItem);
    if (apply) await settle(900);
    else input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: apply ? 'Enter' : 'Escape', keyCode: apply ? 13 : 27 }));
    if (!(await waitFor(() => !openMenu(), 3000))) {
      const btn = labelsButton();
      if (btn) realClick(btn);                              // clicking the button again closes the menu
      if (!(await waitFor(() => !openMenu(), 2000))) throw new Error('Could not close the Labels menu.');
    }
  }

  /**
   * Add labels to the selected email through Gmail's Labels menu.
   * Order matters: the run's Gmail search hides emails that have an action label, so the
   * moment the action label lands the email can vanish from the list. So we
   *   1) check which labels exist, 2) create missing non-action labels (Gmail applies them),
   *   3) tick every existing label and Apply in one go, 4) create the action label last if missing.
   */
  async function applyLabels(names, actionLabel, opts = {}) {
    // 1) Which labels already exist?
    let menu = await openLabelsMenu();
    const missing = [];
    for (const name of names) {
      typeInto(menu.querySelector(SEL.menuInput), name);
      await sleep(400);
      if (!findLabelItem(menu, name)) missing.push(name);
    }
    await closeLabelsMenu(menu, false);

    // 2) Create missing labels other than the action label. If Gmail won't create one,
    //    skip just that label and keep going (the action label is what matters for progress).
    const skipped = [];
    for (const name of missing.filter(n => n !== actionLabel)) {
      try { await createAndApply(name); }
      catch (e) { skipped.push(name); if (openMenu()) await closeLabelsMenu(openMenu(), false).catch(() => {}); }
    }

    // 3) Tick all existing ones (including the action label if it exists) and Apply once.
    //    When archiving, the action label is left for step 4 ("Move to" = label + archive at once).
    const existing = names.filter(n => !missing.includes(n) && !(opts.archive && n === actionLabel));
    if (existing.length) {
      menu = await openLabelsMenu();
      let ticked = 0;
      for (const name of existing) {
        typeInto(menu.querySelector(SEL.menuInput), name);
        await sleep(400);
        const hit = findLabelItem(menu, name);
        if (hit && hit.getAttribute('aria-checked') !== 'true') { realClick(hit); ticked++; await sleep(200); }
      }
      await closeLabelsMenu(menu, ticked > 0);
    }

    // 4) Action label goes last. With archive on, use Gmail's "Move to" so it leaves the inbox too.
    let archived = false;
    if (opts.archive) {
      archived = await moveTo(actionLabel).catch(() => false);
      if (!archived) {                                      // no "Move to" button: just label it
        if (missing.includes(actionLabel)) await createAndApply(actionLabel);
        else { const m = await openLabelsMenu(); typeInto(m.querySelector(SEL.menuInput), actionLabel); await sleep(400);
               const hit = findLabelItem(m, actionLabel); if (hit) realClick(hit); await closeLabelsMenu(m, !!hit); }
      }
    } else if (missing.includes(actionLabel)) {
      await createAndApply(actionLabel);
    }
    return { skipped, archived };
  }

  /** Gmail's "Move to" menu: puts the selected email under `name` and takes it out of the inbox. */
  async function moveTo(name) {
    const btn = await waitFor(() => [...document.querySelectorAll(SEL.moveButton)].find(visible) || null, 3000);
    if (!btn) return false;
    realClick(btn);
    const menu = await waitFor(openMenu, 4000);
    if (!menu) return false;
    typeInto(menu.querySelector(SEL.menuInput), name);
    await sleep(500);
    let item = findLabelItem(menu, name);
    if (!item) {                                            // label doesn't exist yet: Move to → Create new
      item = [...menu.querySelectorAll(SEL.menuItem)].find(i => visible(i) && /create new/i.test(i.innerText));
      if (!item) { await closeLabelsMenu(menu, false).catch(() => {}); return false; }
      realClick(item);
      const isCreate = b => visible(b) && /^create$/i.test((b.innerText || '').trim());
      const ok = await waitFor(() => [...document.querySelectorAll(SEL.dialogButton)].find(isCreate), 4000);
      if (!ok) return false;
      realClick(ok);
      await settle(1500);
      return true;
    }
    realClick(item);
    await waitFor(() => !openMenu(), 3000);
    await settle(900);
    return true;
  }

  /** Gmail's "Create new" in the Labels menu: creates the label and applies it to the selection. */
  async function createAndApply(name) {
    const menu = await openLabelsMenu();
    typeInto(menu.querySelector(SEL.menuInput), name);
    await sleep(600);
    const existing = findLabelItem(menu, name);
    if (existing) {                                           // appeared after all: tick and apply
      if (existing.getAttribute('aria-checked') !== 'true') realClick(existing);
      await sleep(200);
      await closeLabelsMenu(menu, true);
      return;
    }
    const depth = el => { let d = 0; while ((el = el.parentElement)) d++; return d; };
    const withText = [...menu.querySelectorAll(SEL.menuItem + ', div, span')]
      .filter(i => visible(i) && /create new/i.test(i.innerText));
    const create = withText.find(i => /menuitem/.test(i.getAttribute('role') || ''))
      || withText.sort((a, b) => depth(b) - depth(a))[0];
    if (!create) {
      const seen = (menu.innerText || '').replace(/\s+/g, ' ').slice(0, 120);
      await closeLabelsMenu(menu, false).catch(() => {});
      throw new Error(`No "${name}" label and no "Create new" option. The menu showed: "${seen}". ` +
        'Create this label once in Gmail (left sidebar → Labels → +) and press Start again.');
    }
    realClick(create);
    const isCreate = b => visible(b) && /^create$/i.test((b.innerText || '').trim());
    const ok = await waitFor(() => [...document.querySelectorAll(SEL.dialogButton)].find(isCreate), 4000);
    if (!ok) throw new Error('The "New label" dialog did not appear for ' + name);
    realClick(ok);
    await waitFor(() => ![...document.querySelectorAll(SEL.dialogButton)].some(isCreate), 4000);
    await settle(1500);
  }

  function goToSearch(query) {
    // A harmless alternating term forces Gmail to re-run the search (so labelled threads drop out).
    root.__jevFlip = !root.__jevFlip;
    const q = query + (root.__jevFlip ? ' -in:chats' : ' -in:spam');
    location.hash = '#search/' + encodeURIComponent(q).replace(/%20/g, '+');
  }

  async function waitForList() {
    await sleep(600);
    return waitFor(() => {
      const main = mainArea();
      if (!main) return null;
      if (listRows().length) return 'rows';
      // An empty search shows a message instead of rows.
      if (/no messages matched|no conversations/i.test(main.innerText)) return 'empty';
      return null;
    }, 12000);
  }

  /** Gmail only shows the Labels button while an email is ticked, so tick the first row briefly. */
  async function diagnose() {
    const rows = listRows();
    const first = rows[0];
    let button = !!labelsButton();
    if (!button && first && first.querySelector(SEL.checkbox)) {
      await setSelected(first, true).catch(() => {});
      button = !!(await waitFor(labelsButton, 3000));
      await setSelected(first, false).catch(() => {});
    }
    return {
      email: myEmail() || 'not found',
      rows: rows.length,
      firstRow: first ? readRow(first) : null,
      checkbox: !!(first && first.querySelector(SEL.checkbox)),
      labelsButton: button,
    };
  }

  root.JevGmailUI = { SEL, sleep, settle, dismissGmailError, listRows, readRow, readFullBody, findRowById, setSelected, applyLabels, goToSearch, waitForList, myEmail, diagnose };
})(window);
