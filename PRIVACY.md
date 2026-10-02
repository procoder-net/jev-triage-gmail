# Privacy policy

**What the extension reads.** When you press **Start** or **Learn my inbox**, it reads the emails shown in your open Gmail tab: sender name and address, subject, date and preview text. If you turn on "Open each email", it also reads up to 1,500 characters of each email's body.

**Where that goes.** Each email's text is sent to TypeSafe AI's Jev API (`api.typesafe.ai`) with the API key you provide, to decide its labels. Emails from senders that have a rule with a fixed action are not sent anywhere. Nothing is sent to the project's authors or any other server. There is no analytics or tracking.

**What is stored.** Your Jev key, your categories and sender rules, and simple counts, all in your browser (`chrome.storage.local`). Uninstalling the extension removes them.

**What it changes in Gmail.** It adds labels and, if aggressive ignore is on, archives Low/Junk emails. It never deletes, sends, forwards or marks email as spam.

**Contact.** Open an issue on this repository.
