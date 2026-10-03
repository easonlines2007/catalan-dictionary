# Català — Pocket dictionary

English · [中文](README.zh-CN.md) · [Español](README.es.md)

I came to Barcelona to study, but my Catalan is pretty terrible—so I made a
Catalan–Chinese–Spanish dictionary to help myself out. Feel free to use it!

A mobile-friendly dictionary with word-form lookup, pronunciation, saved words
and offline access. It covers about 97,000 Catalan entries; Chinese meanings
are available for a small, reviewed subset.

## Open and search

[Open the dictionary](https://catalan-dictionary-pwa.vercel.app) in your browser.
No account, sign-in or software download is needed for online use.

<img src="docs/images/home.jpg" width="320" alt="Dictionary home screen with a Catalan search box and suggested words">

*The home screen: search at the top, Cerca and Desats at the bottom.*

1. Type a **Catalan** word or word form in the search box.
2. Press **Enter** or tap the **→** button. Try `pujant`: the app finds `pujar`.
3. Read the available meanings, examples and word-form information.
   If several matches appear under **Altres coincidències possibles**, tap one.

<img src="docs/images/lookup.jpg" width="280" alt="Word-form lookup resolving pujant to pujar, with a pronunciation button">
<img src="docs/images/lookup-details.jpg" width="280" alt="Scrolling down to read Catalan, Chinese and Spanish meanings and examples for pujar">

*pujant → pujar. Scroll down for translations, examples and the save button.*

The search works from Catalan to the available meanings. It does not provide
reverse Chinese/Spanish search or translate whole sentences. Not every entry
has all three languages, pronunciation notation or examples; some entries use
Catalan definitions or English definitions when other meanings are unavailable.

Keep accents when possible. For example, `coneixer` suggests `conèixer`;
tap the suggestion to open it. Suggestions help with some spelling mistakes,
but a missing word may still need a different spelling or its dictionary form.

## Listen, save and revisit

- Tap **🔊** to hear the word using your browser or system speech service.
  A Catalan voice may need to be downloaded in your device's voice settings.
  Voice quality and offline playback depend on your device and chosen voice.
- Tap **☆ Desa** on a result to save the word; the button becomes **★ Desat**.
- Open **Desats** at the bottom to see saved words. Tap a word to look it up,
  or tap its star to remove it.
- Tap **Cerca** to return to the home screen. **Recent** shows recent successful
  searches; tap one to search again. **Esborra** clears history only.

<img src="docs/images/saved.jpg" width="320" alt="Desats screen showing saved Catalan words and their available translations">

*Saved words are kept in this browser on this device.*

There is no account sync or built-in export. Saved words, history and downloaded
data stay local to your browser. Clearing site data or using private browsing
can remove them or prevent saving. Saving a word alone does not replace the
complete offline download; opening a saved word performs another lookup.

## Prepare offline access

Open the app **while connected** first and let setup finish. The essential
vocabulary contains about 5,000 entries; the rest loads as you search online.
For the whole dictionary:

1. Return to **Cerca** and find **Desa tot per usar-lo sense connexió**.
   On the current live version, if history hides this button, tap **Esborra**
   first. This clears recent searches, but keeps saved words.
2. Tap the download button and keep the page open. The compressed dictionary
   is about **15 MB**; allow extra browser storage for the app and its data.
3. Wait until the button reads **Diccionari complet desat** before going offline.
4. If the download stops, reconnect and tap it again to resume stored parts.

<img src="docs/images/offline.jpg" width="320" alt="Offline setup screen showing the complete dictionary saved on the device">

*“Diccionari complet desat” indicates that the full download has finished.*

Offline access needs the app and dictionary to have been prepared successfully
in the same browser. Browser storage can be cleared or evicted, so check it
before relying on it during travel. When dictionary data changes, reopen online
and download the new version before using the full dictionary offline again.

## Add it to your home screen

- **iPhone/iPad:** open in Safari → Share → Add to Home Screen → Add.
  If an **Open as Web App** switch appears, keep it on.
- **Android Chrome:** open the menu beside the address bar → Install and create
  shortcut → Install, then follow the prompts.
- **Desktop Chrome:** use the address-bar install icon, or the menu → Cast,
  save, and share → Install page as app. Other supporting browsers may differ.

Menu names and availability vary with your browser and OS version. Installation
is optional and does not automatically download the complete dictionary.
See the official [Apple](https://support.apple.com/guide/iphone/iphea86e5236/ios),
[Android Chrome](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en)
and [desktop Chrome](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DDesktop&hl=en) guides.

## If something does not work

Use a recent browser. If an entry fails to load, reconnect and refresh; for a
missing word, check accents or try its dictionary form. If saving or downloading
fails, check free storage and avoid private browsing. If speech is unavailable,
check the device's installed voices. [Report a problem](https://github.com/easonlines2007/catalan-dictionary/issues)
with your browser, device and the word you searched; avoid posting personal data.

## Run locally

With **Node.js 22**:

```bash
git clone https://github.com/easonlines2007/catalan-dictionary.git
cd catalan-dictionary
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). For a production-mode check, stop
the development server, run `npm run build` and then `npm start`. Offline app
caching is enabled in production mode, so use that mode to test offline reloads.

Verify with `npm test`, `npm run lint` and `npm run typecheck`.

Application code: [MIT](LICENSE). Dictionary data keeps its original licenses:
[sources and attribution](DATA_SOURCES.md). [Privacy](PRIVACY.md).
