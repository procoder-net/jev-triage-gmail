// Categories, labels and sender rules. These are neutral DEFAULTS for any user.
// Each person's own rules come from "Learn my inbox" in the Gmail panel and from the
// Options page; those are saved in chrome.storage and override these defaults.
//
// Label names avoid "&" and other symbols because Gmail's label menu search trips on them.
// A topic can point at a label the user already has (edit it in Options).
(function (root) {
  const DEFAULTS = {
    urgentLabel: 'Jev/Urgent',
    reviewLabel: 'Jev/Review',
    // Must See: the few emails worth your time. Added when a real person wrote to you, something
    // needs doing, it's urgent, or a sender rule says so. Pair with Gmail's Multiple Inboxes.
    mustSeeLabel: 'Jev/0-Must-See',
    // Out of the inbox: emails with these actions are labelled AND archived (never deleted;
    // still in All Mail under their label). 'archive' keeps records for future reference.
    ignoreActions: ['low', 'junk', 'archive'],
    archiveIgnored: true,

    // What to do with the email (exactly one per email).
    actions: [
      { key: 'reply',  label: 'Jev/1-Reply',  desc: 'A real person (family, friend, colleague, teacher, client, recruiter, a business I deal with) wrote to me personally and expects an answer from me.' },
      { key: 'action', label: 'Jev/2-Action', desc: 'No reply needed, but I must DO something: pay or check a bill, sign up or RSVP, fill a form, verify or secure an account I did not expect, act on a deadline.' },
      { key: 'read',   label: 'Jev/3-Read',   desc: 'Articles and newsletters I subscribed to and may want to read later. Not summaries of my own accounts. No action needed.' },
      { key: 'fyi',    label: 'Jev/4-FYI',    desc: 'Automated confirmation or status about my own accounts: receipts, order and delivery updates, refunds, routine sign-in notices I triggered, one-time codes, statements with nothing due, autopay confirmations, daily or weekly summaries.' },
      { key: 'low',    label: 'Jev/5-Low',    desc: 'Marketing and bulk mail: sales, discounts, coupons, product pitches, job-alert digests, event invitations sent to a list, community posts and digests, cold sales pitches.' },
      { key: 'junk',   label: 'Jev/6-Junk',   desc: 'Scam, phishing, fake invoice, fake registration, or junk with no legitimate purpose.' },
      { key: 'archive', label: 'Jev/7-Archive', desc: 'Records to keep for future reference, nothing to do now: tax forms, invoices and receipts for services, warranties and protection plans, contracts and terms I agreed to, booking or registration confirmations, school or medical documents.' },
    ],

    // What the email is about (exactly one per email).
    topics: [
      { key: 'personal',  label: 'Topic/Personal',  desc: 'Family, friends and personal plans.' },
      { key: 'kids',      label: 'Topic/Kids',      desc: "Children's school, teachers, classes, sports, camps and activities." },
      { key: 'work',      label: 'Topic/Work',      desc: 'My job, colleagues, clients, projects and work tools.' },
      { key: 'career',    label: 'Topic/Career',    desc: 'Recruiters, interviews, job applications, job-alert digests, professional networking.' },
      { key: 'finance',   label: 'Topic/Finance',   desc: 'Banks, credit cards, statements, bills, payments, insurance, taxes, investing, refunds of money.' },
      { key: 'shopping',  label: 'Topic/Shopping',  desc: 'Online orders, deliveries, returns, food delivery, store promotions, retail brands.' },
      { key: 'security',  label: 'Topic/Security',  desc: 'Sign-in alerts, one-time codes, password resets, new devices, apps given access to my account, terms-of-service changes.' },
      { key: 'news',      label: 'Topic/News',      desc: 'Newsletters, blogs, digests and industry news.' },
      { key: 'community', label: 'Topic/Community', desc: 'Neighborhood, clubs, meetups, mailing lists, groups and local events.' },
      { key: 'health',    label: 'Topic/Health',    desc: 'Doctors, pharmacy, health portals, gyms and fitness apps.' },
      { key: 'home',      label: 'Topic/Home',      desc: 'Utilities, internet, phone plan, smart-home devices, home services, travel and reservations.' },
      { key: 'other',     label: 'Topic/Other',     desc: 'Anything that fits none of the other topics.' },
    ],

    // Known senders. `match` is a domain or a full address. `topic` is always applied; with an
    // `action`, Jev is skipped for that sender; `mustSee` adds the Must See label.
    // Empty for a new user: "Learn my inbox" in the Gmail panel fills it in from their own mail.
    rules: [],
  };

  /** Which sender key to group by when learning: full address for personal mailboxes, else the domain. */
  const PERSONAL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
    'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'msn.com']);
  function senderKey(email) {
    email = (email || '').toLowerCase();
    const domain = email.split('@')[1] || '';
    if (!domain || PERSONAL_DOMAINS.has(domain)) return email;
    const parts = domain.split('.');
    // Keep 3 parts for country domains like co.uk / com.au, otherwise the last 2 (news.example.com → example.com).
    const n = parts.length > 2 && parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length === 2 ? 3 : 2;
    return parts.slice(-n).join('.');
  }

  /**
   * Turn Gmail-filter-ready groups out of sender rules.
   * Returns Gmail's mailFilters.xml text: import it under Settings → Filters → Import filters.
   */
  function filtersXml(t) {
    const esc = v => String(v).replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const groups = new Map();
    for (const r of t.rules || []) {
      const act = byKey(t.actions, r.action);
      const top = byKey(t.topics, r.topic);
      const key = [r.mustSee ? 1 : 0, r.action || '', r.topic || ''].join('|');
      if (!groups.has(key)) groups.set(key, { r, act, top, senders: [] });
      groups.get(key).senders.push(r.match);
    }
    const entries = [];
    for (const g of groups.values()) {
      // Gmail limits filter length, so split long sender lists.
      for (let i = 0; i < g.senders.length; i += 25) {
        const props = [['from', '(' + g.senders.slice(i, i + 25).join(' OR ') + ')']];
        const ignored = g.r.action && (t.ignoreActions || []).includes(g.r.action) && !g.r.mustSee;
        if (g.r.mustSee && t.mustSeeLabel) {
          props.push(['label', t.mustSeeLabel], ['shouldStar', 'true'], ['shouldAlwaysMarkAsImportant', 'true'], ['shouldNeverSpam', 'true']);
        }
        if (g.act) props.push(['label', g.act.label]);
        if (g.top) props.push(['label', g.top.label]);
        if (ignored && t.archiveIgnored) props.push(['shouldArchive', 'true'], ['shouldMarkAsRead', 'true'], ['shouldNeverMarkAsImportant', 'true']);
        if (g.r.action === 'read') props.push(['shouldArchive', 'true'], ['shouldNeverMarkAsImportant', 'true']);
        // Gmail allows one label per filter: emit one entry per label, same criteria.
        const labels = props.filter(p => p[0] === 'label');
        const other = props.filter(p => p[0] !== 'label');
        const sets = labels.length ? labels.map((l, j) => j === 0 ? [l, ...other] : [l, other[0]]) : [other];
        for (const set of sets) {
          entries.push("<entry><category term='filter'></category><title>Mail Filter</title><content></content>" +
            set.map(([k, v]) => `<apps:property name='${k}' value='${esc(v)}'/>`).join('') + '</entry>');
        }
      }
    }
    return "<?xml version='1.0' encoding='UTF-8'?><feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'><title>Jev Triage filters</title>" +
      entries.join('') + '</feed>';
  }

  function slug(label) {
    return (label.split('/').pop() || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'x';
  }

  /** Current taxonomy: saved edits from Options, or the defaults. */
  async function load() {
    try {
      const { taxonomy } = await chrome.storage.local.get('taxonomy');
      if (taxonomy && taxonomy.actions && taxonomy.actions.length && taxonomy.topics && taxonomy.topics.length) {
        return { ...DEFAULTS, ...taxonomy };
      }
    } catch (e) { /* fall back to defaults */ }
    return JSON.parse(JSON.stringify(DEFAULTS));
  }

  function byKey(list, key) { return list.find(x => x.key === key) || null; }

  /** Find the rule for a sender: exact address first, then domain and parent domains. */
  function ruleFor(t, email) {
    email = (email || '').toLowerCase();
    const rules = t.rules || [];
    const exact = rules.find(r => r.match.toLowerCase() === email);
    if (exact) return exact;
    let d = email.split('@')[1] || '';
    while (d) {
      const r = rules.find(x => x.match.toLowerCase() === d);
      if (r) return r;
      d = d.includes('.') ? d.slice(d.indexOf('.') + 1) : '';
    }
    return null;
  }

  function gmailLabelToken(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  /** Gmail search fragment that hides everything that already has an action label. */
  function unsortedQuery(t) {
    return t.actions.map(a => '-label:' + gmailLabelToken(a.label)).join(' ');
  }

  root.JEV_TAXONOMY = { DEFAULTS, load, byKey, ruleFor, slug, unsortedQuery, senderKey, filtersXml };
})(typeof self !== 'undefined' ? self : window);
