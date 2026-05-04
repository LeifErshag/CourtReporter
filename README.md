# CourtReporter

A Chrome extension that helps royals and heralds fill out the
[Drachenwald Court Report form](https://docs.google.com/forms/d/e/1FAIpQLSd3S-CFFM-Ed5eLBFe81MKSBeCzGGsl_QLppHKMH4FdkfxIjw/viewform).

It replaces the spreadsheet that is currently used to assemble the
`Report Summary` and `Secret Awards` fields. Each recipient is entered into a
small form (SCA name, mundane name, award, scroll info, token info) and the
extension produces text that matches the regular expression the form expects:

```
SCA Name (Mundane Name): Award, scroll status (scroll maker), token status (token maker)
```

## Features

- Two tabs, one per form field (`Report Summary` and `Secret Awards`).
- Add / remove / reorder recipients.
- Award name autocomplete from a bundled list, refreshable from the public
  [Drachenwald OP awards page](https://op.drachenwald.sca.org/awards).
- Optional name verification (opt-in toggle): per-entry "Verify names" button
  that queries [op.drachenwald.sca.org/search](https://op.drachenwald.sca.org/search)
  and shows badges ("SCA Name Found", "Modern Name Found") plus a "✓✓ The
  results for SCA and modern name matches" indicator when both names appear
  together in the same OP record.
- One-click "Insert into form" that writes the formatted text into the matching
  textarea on the active Google Forms tab (uses a React-compatible value setter
  so Forms validation actually picks the value up).
- "Copy" button as a fallback if you'd rather paste manually.
- Auto-saves your draft to `chrome.storage.local` so you don't lose work if the
  popup closes. "Clear draft" wipes it.

## Privacy & GDPR

This extension does **not** transmit recipient names, mundane names, draft text,
or any other personal data anywhere. Specifically:

- All editing happens inside the extension popup.
- Drafts are stored only in `chrome.storage.local` on the device using the
  extension. There is no sync, no cloud, no analytics, no telemetry.
- "Insert into form" writes directly into the form fields on the Google Forms
  page you have open in the active tab. Nothing leaves your browser via this
  action that wouldn't have if you typed the text yourself.
- "Refresh awards list" makes a single GET request to
  `https://op.drachenwald.sca.org/awards`. This request contains no personal
  data — it just downloads the public award list.
- "Open OP name search" opens
  `https://op.drachenwald.sca.org/search` in a new tab so you can verify
  spelling manually.
- **"Verify names via OP search"** is an opt-in toggle (off by default). When
  it is enabled and you click the per-entry **Verify names** button, the SCA
  name and mundane name for that entry are POSTed (as `persona=<name>` form
  data) to `https://op.drachenwald.sca.org/search` in order to confirm
  spelling. The
  result is shown as small badges next to each field ("SCA Name Found",
  "Modern Name Found") and, if both names appear together in a single OP
  record, a combined "✓✓ The results for SCA and modern name matches"
  indicator on the entry. Verification results are kept only in memory; they
  are stripped before the draft is written to local storage.
- "Clear draft" removes the locally stored draft.

The extension requests these Chrome permissions:

| Permission | Why |
| --- | --- |
| `storage` | Store the draft and cached awards list on your device. |
| `scripting` + `activeTab` | Inject the formatted text into the Google Forms field on the tab you're looking at, only when you click "Insert into form". |
| host permission `https://docs.google.com/forms/*` | Required so `scripting.executeScript` can target the form page. |
| host permission `https://op.drachenwald.sca.org/*` | Only used by the manual "Refresh awards list" action. |

## Install (developer mode)

1. Clone this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Enable "Developer mode".
4. Click "Load unpacked" and select the repository directory.
5. Pin the extension if you want quick access.

## Use

1. Open the Drachenwald Court Report form in a tab.
2. Click the extension icon.
3. Pick the tab — `Report Summary` or `Secret Awards`.
4. Add recipients. The generated text below updates as you type.
5. Click `Insert into form`. The text is written into the matching field. If
   the field can't be found, use `Copy` and paste it manually.
6. (Optional) Click `Refresh awards list` to pull the current awards from the OP.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 declaration. |
| `popup.html` / `popup.css` / `popup.js` | The whole UI. |
| `awards.json` | Bundled fallback awards list, used until you refresh. |

## Limitations

- The "Insert into form" feature relies on Google Forms' DOM structure. If
  Google ships a redesign, the field-finder may need to be updated.
- The awards list parser uses a heuristic against the OP page's HTML; if the
  OP page is restructured, the heuristic may need tuning. The bundled fallback
  list will continue to work.
- Icons are in `icons/` (16, 48, 128 px). To replace them, drop new PNGs at
  the same paths and reload the extension.
