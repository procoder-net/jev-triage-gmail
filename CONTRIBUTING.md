# Contributing

Thanks for helping. This project is small on purpose: plain JavaScript, no build step, no framework.

## Set up

1. Fork the repo and clone your fork.
2. `npm install && npx playwright install chromium`
3. Load `extension/` in `chrome://extensions` (Developer mode → Load unpacked).
4. After a code change, click reload ↻ on the extension card and reload your Gmail tab.

## Before you open a pull request

- Run `npm test`. Both the unit checks and the end-to-end run must pass.
- If you changed anything you can see (panel, options), run `npm run screenshots` and commit the updated images.
- Keep the extension's promises: it only **adds labels** and, when the user turns it on, **archives** Low/Junk. No deleting, sending, forwarding or marking as spam.
- Keep data flow the same: email text goes only to `api.typesafe.ai`, with the user's own key. No analytics, no other servers.
- Use made-up data in examples and tests (`*.example` domains). Never commit real email addresses, real inbox content or API keys.

## When Gmail changes

Gmail's page is not a public API, so it changes now and then. When the extension breaks:

1. Open Gmail, right-click the element that's no longer found (a row checkbox, the Labels button, the label menu) and choose **Inspect**.
2. Update the selector in `SEL` at the top of `extension/gmail-ui.js`.
3. Make the same change in `test/mock-gmail.html` so the test copies the new page.
4. Run `npm test`, then try it on your real Gmail.

Please mention your Gmail language and whether you use any Gmail themes or other extensions in the PR.

## Style

- Plain browser JavaScript, 2-space indent, semicolons, single quotes.
- Short functions with a one-line comment saying *why* when it isn't obvious.
- User-facing text: short, plain English, say what happened and what to do next.

## Commit and PR

- One topic per PR. Describe what changed, why, and how you tested it.
- Link the issue if there is one.
- By contributing you agree your work is released under the MIT license.

## Code of conduct

Be kind and assume good intent. Harassment or personal attacks aren't tolerated. Maintainers may remove comments or contributors that break this. Report problems by opening an issue marked "conduct", or privately to the maintainers.
