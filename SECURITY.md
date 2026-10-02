# Security

## Your Jev API key

- Paste it only into the extension's **Options** page. It is stored in `chrome.storage.local` in your browser and sent only to `api.typesafe.ai`.
- **Never** put a key in an issue, pull request, screenshot, commit or settings file. **Export settings** leaves the key out on purpose.
- If a key is exposed, revoke it in your TypeSafe AI account and create a new one.

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's **Security → Report a vulnerability** on this repository, or contact the maintainers privately. Include steps to reproduce and the extension version.

## Scope

The extension runs only on `mail.google.com` and talks only to `api.typesafe.ai`. It has the `storage` permission and no others. Reports about anything that widens this, leaks email content or keys, or lets a web page drive the extension are especially welcome.
