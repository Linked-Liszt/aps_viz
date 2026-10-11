# Notes for AI agents and automated tools

## Author-owned content: do not modify

Everything in `src/author/` (`welcome.md`, `note.md`) is written by the exhibit's author: the welcome dialog shown
on open and the *Author's note* page. **Never edit, rewrite, reformat, "fix", move or delete these files**, including
during audits, refactors, typo sweeps or content rewrites. Suggest changes to the author instead.

The code that displays them (`src/ui/Author.ts`, `src/lib/markdown.ts`) may be changed, as long as the files keep
rendering as they do now.

## Everything else

See `README.md` for commands, the code map and how the content is sourced. Generated data
(`src/data/facility.json`, `sectors.json`, `site.json`) is rebuilt from `research/` with `scripts/`; edit the
overrides in `scripts/exhibit-overrides/`, not the generated JSON.
