# Using Jev Triage

A practical guide: first run, daily use, and how to build good rules quickly (including with an AI assistant).

## The 10-minute first run

1. **Install** the extension (README → *Install and first run*) and paste your Jev key in **Options**.
2. **Open Gmail** and click the blue **Jev** button, then **Check**. You want `checkbox: yes · Labels button: yes`.
3. **Learn my inbox** with 200 emails. Tick the suggestions that look right, click **Save selected**.
4. **Preview:** tick *Preview only*, click **Start**. Ten emails are classified and shown in the panel, nothing is labelled. If the results look wrong, fix your rules or descriptions first (below).
5. **Sort:** untick *Preview only*, leave **All mail** selected, click **Start**. Leave the tab open and visible.
6. **Download Gmail filters** and import them (Gmail ⚙ → See all settings → Filters and Blocked Addresses → Import filters). New mail from known senders is now sorted by Gmail itself.
7. **Optional:** set Gmail's Inbox type to *Multiple inboxes* with `label:jev-0-must-see` on top.

## Day to day

| When | Do this |
|---|---|
| Morning | Read **Must See** first. Then **To do** (`Jev/1-Reply`, `Jev/2-Action`). |
| Once or twice a week | Skim `Jev/3-Read`. Open the Jev panel and press **Start** to sort anything new. |
| Something landed in the wrong place | Add or fix a **sender rule** in Options, or sharpen the description of the label it should have gone to. |
| Every few weeks | Run **Learn my inbox** again (it only suggests senders without a rule) and re-download the Gmail filters. |

## How Jev decides (and how to steer it)

For every email, Jev reads one block of text (sender, subject, preview, and the body if you turned that on) and answers four questions using **your label descriptions**:

1. **What to do**: picks one of your action labels.
2. **What it's about**: picks one of your topic labels.
3. **How urgent**: 1 to 5 (4–5 adds `Jev/Urgent`).
4. **Did a person write this to me**: yes/no (yes, plus Reply/Action/urgent, adds Must See).

So the description is the steering wheel. Good descriptions:

- **Name real kinds of senders and subjects**: "Receipts, shipping updates, booking confirmations, one-time codes" beats "transactional mail".
- **Say what doesn't belong**: "Newsletters I chose to subscribe to. Not summaries of my own accounts."
- **Stay distinct**: if two labels sound alike, Jev will hesitate and you'll see `Jev/Review`.

Sender rules beat Jev:

- **Topic only** (`bank.com → Finance`): always that topic; Jev still picks Reply/Action/FYI.
- **Topic + action** (`store.com → Shopping, Low`): Jev is skipped entirely. Fast, free, predictable.
- **Must see** (`boss@company.com`): always gets the Must See label.

Use a full address for people and a domain for companies.

## Fill your rules with an AI assistant

Learn my inbox is the easiest way. If you'd rather start from a description of your life, or tidy up a long list of senders, any chat assistant (Claude, ChatGPT, Gemini…) can write the settings file for you. Then you import it.

### Option A: describe yourself, get a starter setup

Copy this prompt, fill in the brackets, and paste it into your assistant:

```text
Write a settings file for the "Jev Triage for Gmail" Chrome extension.
Return ONLY valid JSON in exactly this shape:

{
  "jevTriageSettings": 1,
  "taxonomy": {
    "urgentLabel": "Jev/Urgent",
    "reviewLabel": "Jev/Review",
    "mustSeeLabel": "Jev/0-Must-See",
    "ignoreActions": ["low", "junk"],
    "archiveIgnored": true,
    "actions": [ { "key": "reply", "label": "Jev/1-Reply", "desc": "..." }, ... ],
    "topics":  [ { "key": "work",  "label": "Topic/Work",  "desc": "..." }, ... ],
    "rules":   [ { "match": "example.com", "topic": "work", "action": "low", "mustSee": true }, ... ]
  }
}

Rules for the file:
- Keep these 6 actions and keys: reply, action, read, fyi, low, junk (labels Jev/1-Reply ... Jev/6-Junk).
  Rewrite their "desc" to fit me.
- Create 8 to 14 topics that fit my life. "key" is short lowercase, "label" starts with "Topic/",
  no "&", quotes or angle brackets. Always include a final "other" topic.
- Each "desc" is one or two sentences naming the real kinds of senders and subjects that belong there,
  and what does NOT belong if it could be confused with another label.
- "rules": one per sender I list below. "match" is a domain (company) or a full address (person).
  "topic" must be one of the topic keys. Add "action" only when every email from that sender gets
  the same treatment (for example newsletters → "read", stores and promos → "low").
  Add "mustSee": true only for people and organisations I must never miss.

About me:
[your job, family situation, side projects, hobbies, what kinds of email you get]

Senders I hear from (one per line, add a note if useful):
[boss@company.com — my manager
school-district.org — kids' school
bank.com
store.com — sales emails I never read
newsletter.com — I read this one on weekends]
```

Then: **Options → Import settings** → choose the file → check it over → **Save**.

### Option B: turn your Learn results into better descriptions

After a few runs, export your settings (**Options → Export settings**) and ask:

```text
Here is my Jev Triage settings JSON. Improve it without changing the JSON shape or any "key":
- Rewrite each action and topic "desc" so they don't overlap and name concrete examples.
- Suggest rules for senders that look like bulk mail (stores, promos, digests) with "action": "low".
- Flag any rule whose "topic" or "action" doesn't exist.
Return only the improved JSON.
[paste the file]
```

### Before you paste anything into an AI tool

- **Never include your Jev API key.** Exported settings never contain it.
- Sender addresses are personal data. Leave out anyone you'd rather not share, or replace them with a domain.
- Always read the result before importing: the extension checks the shape, but only you know if "store.com → Low" is right.

## Troubleshooting

| You see | Do this |
|---|---|
| `Labels button: NO` after Check | Make sure a list (not an open email) is showing and Gmail is in English. |
| "Oops, something went wrong" from Gmail | The extension waits and retries automatically. If it keeps happening, sort in smaller sessions. |
| A red **skipped** chip | That email failed; it'll be retried next Start. |
| Wrong labels on many emails | Run **Preview**, then fix descriptions or add sender rules. |
| Stopped: "5 emails in a row failed" | Reload the Gmail tab and press Start again. If it repeats, open an issue with the message. |
