# Amazon SDE Intern OA practice dojo (hosted version)

Open https://richardharnisch.github.io/amazon-sde-oa-dojo/ . This is an original, unofficial practice site, not a live OA or Amazon product.

Runs fully in your browser; there is no remote code-execution server. Python runs in a Pyodide Web Worker loaded from the version-pinned jsDelivr CDN (internet is needed on first load). The Node-style mini-repository is checked by equivalent browser-side assertions. A stuck worker is terminated after 45 seconds. No accounts or API keys are required.

Progress and editable repositories stay in your browser localStorage, **not synced across devices**. Use the Export / Import buttons to move progress between browsers. Import replaces the destination browser's dojo data. The original exercises, including educational hidden cases and reference code, are publicly downloadable; solution gating in the interface is for honest practice, not test security.

To rebuild from the source project: `python3 -m dojo.build_site`. Do **not** expose the local Python server on the internet: it executes submitted code without a security sandbox. See the source project's `RESEARCH_SUMMARY.md` and `SOURCES.md` for evidence and limits.
