const T = window.JEV_TAXONOMY;
const $ = id => document.getElementById(id);
let state;

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function catRow(kind, item, i) {
  return `<tr data-kind="${kind}" data-i="${i}">
    <td><input data-f="label" value="${esc(item.label)}" placeholder="e.g. Topic/Travel"></td>
    <td><textarea data-f="desc" rows="2" placeholder="When should Jev pick this?">${esc(item.desc)}</textarea></td>
    <td class="del"><button class="x" data-del="${kind}" data-i="${i}" title="Remove">✕</button></td></tr>`;
}

function options(list, selected, blank) {
  return (blank ? `<option value="">${blank}</option>` : '') +
    list.map(x => `<option value="${esc(x.key)}" ${x.key === selected ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
}

function ruleRow(r, i) {
  return `<tr data-kind="rules" data-i="${i}">
    <td><input data-f="match" value="${esc(r.match)}" placeholder="example.com or person@example.com"></td>
    <td><select data-f="topic">${options(state.topics, r.topic)}</select></td>
    <td><select data-f="action">${options(state.actions, r.action, '— ask Jev —')}</select></td>
    <td><input data-f="mustSee" type="checkbox" style="width:auto" ${r.mustSee ? 'checked' : ''}></td>
    <td class="del"><button class="x" data-del="rules" data-i="${i}" title="Remove">✕</button></td></tr>`;
}

function render() {
  $('actions').innerHTML = state.actions.map((x, i) => catRow('actions', x, i)).join('');
  $('topics').innerHTML = state.topics.map((x, i) => catRow('topics', x, i)).join('');
  $('rules').innerHTML = state.rules.map(ruleRow).join('');
  $('urgentLabel').value = state.urgentLabel;
  $('reviewLabel').value = state.reviewLabel;
  $('mustSeeLabel').value = state.mustSeeLabel || '';
  $('archiveIgnored').checked = !!state.archiveIgnored;
}

/** Read the form back into state; keeps keys stable for existing rows, makes keys for new ones. */
function collect() {
  for (const kind of ['actions', 'topics']) {
    const rows = [...document.querySelectorAll(`tr[data-kind="${kind}"]`)];
    const used = new Set();
    state[kind] = rows.map(tr => {
      const old = state[kind][Number(tr.dataset.i)] || {};
      const label = tr.querySelector('[data-f="label"]').value.trim();
      const desc = tr.querySelector('[data-f="desc"]').value.trim();
      let key = old.key || T.slug(label);
      while (used.has(key)) key += '_2';
      used.add(key);
      return { key, label, desc };
    }).filter(x => x.label);
  }
  state.rules = [...document.querySelectorAll('tr[data-kind="rules"]')].map(tr => ({
    match: tr.querySelector('[data-f="match"]').value.trim().toLowerCase(),
    topic: tr.querySelector('[data-f="topic"]').value,
    action: tr.querySelector('[data-f="action"]').value || undefined,
    mustSee: tr.querySelector('[data-f="mustSee"]').checked || undefined,
  })).filter(r => r.match && r.topic);
  state.urgentLabel = $('urgentLabel').value.trim() || T.DEFAULTS.urgentLabel;
  state.reviewLabel = $('reviewLabel').value.trim() || T.DEFAULTS.reviewLabel;
  state.mustSeeLabel = $('mustSeeLabel').value.trim();
  state.archiveIgnored = $('archiveIgnored').checked;
}

function validate() {
  const bad = [...state.actions, ...state.topics].find(x => /[&"<>]/.test(x.label));
  if (bad) return `"${bad.label}": please avoid & " < > in label names (Gmail's label search trips on them).`;
  if (state.actions.length < 2) return 'Keep at least two action labels.';
  if (state.topics.length < 2) return 'Keep at least two topic labels.';
  return '';
}

document.addEventListener('click', e => {
  const add = e.target.dataset.add, del = e.target.dataset.del;
  if (!add && !del) return;
  collect();
  if (add === 'rules') state.rules.push({ match: '', topic: state.topics[0].key });
  else if (add) state[add].push({ key: '', label: '', desc: '' });
  if (del) state[del].splice(Number(e.target.dataset.i), 1);
  render();
});

$('save').onclick = async () => {
  collect();
  const err = validate();
  $('err').textContent = err; $('msg').textContent = '';
  if (err) return;
  await chrome.storage.local.set({ jevKey: $('key').value.trim(), taxonomy: state });
  render();
  $('msg').textContent = 'Saved. Reload your Gmail tab to use the changes.';
};

$('reset').onclick = () => {
  if (!confirm('Replace your categories and sender rules with the defaults? (Export first if you want a backup.)')) return;
  state = JSON.parse(JSON.stringify(T.DEFAULTS));
  render();
  $('msg').textContent = 'Recommended categories loaded. Click Save to keep them.';
};

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
}

$('dlFilters').onclick = () => {
  collect();
  download('jev-gmail-filters.xml', T.filtersXml(state), 'application/xml');
  $('msg').textContent = 'Downloaded. Gmail ⚙ → See all settings → Filters and Blocked Addresses → Import filters.';
};

// Settings travel without the API key: everyone uses their own Jev key.
$('export').onclick = () => {
  collect();
  download('jev-triage-settings.json', JSON.stringify({ jevTriageSettings: 1, taxonomy: state }, null, 2), 'application/json');
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const t = data.taxonomy || data;
    if (!Array.isArray(t.actions) || !Array.isArray(t.topics)) throw new Error('This file has no categories.');
    state = { ...T.DEFAULTS, ...t, rules: t.rules || [] };
    render();
    $('err').textContent = ''; $('msg').textContent = `Loaded ${state.topics.length} topics and ${state.rules.length} sender rules. Click Save to keep them.`;
  } catch (err) { $('err').textContent = 'Could not import: ' + err.message; }
  e.target.value = '';
};

(async () => {
  const { jevKey } = await chrome.storage.local.get('jevKey');
  $('key').value = jevKey || '';
  state = await T.load();
  state.rules = state.rules || [];
  render();
})();
