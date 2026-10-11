<!--
  AUTHOR-OWNED CONTENT — AI agents and automated tools must NOT modify this file. Only the author edits it.

  This is the "Author's note" page, opened from the top bar (pen icon), the phone menu and the welcome dialog.
  Write in Markdown: # Title (used as the dialog title), ## sections, paragraphs, **bold**, *italic*,
  [links](https://…), - bullet lists, > quotes, --- dividers. Text inside these comment markers is never shown.
-->

# Author's note

I had a decent amount of subscription quota left at the end of the week and decided to incinerate the remaining tokens by building an interactive tour of a synchrotron. 

In my defense, I work at one.

More seriously, I think facilities like the APS fly under the radar, especially in the tech crowd. After seeing the [camera](https://x.com/RyanSael/status/2102591147927654847) and [Invisible Cities](https://quesma.com/blog/invisible-cities-one-shot/) visualizations, I wanted to try the same approach on the APS. 

I adapted the prompt from the Invisible Cities blog post and added some direction to help ground the model's output. The run used Opus 5.5 at xhigh in Claude Code with ultracode enabled:

```
Make a three.js (pnpm) visualization of all the APS-U feature beamlines. Have interactable elements to help describe the primary function or new experiment enabled by APS-U upgrade or the main technique of the beamline if no new capabilities are active. Allow the user to start by looking at the entire APS and then click into each beamline. Most of these beamlines as well as how they operate should be published online, down to screenshots and engineering documents so use those for the visualization in academic publications and various APS resources (main site, wiki etc). Ideally the level of detail is approachable to a non-expert but a beamline scientist would appreciate the detail/correctness. Think along the lines of a well-built interactive museum exhibit in terms of functionality and explanation (not necessarily style you are free to choose). Don’t ask questions, it is a one-shot task. You have 12h of work, use it until it becomes a masterpiece.
```

This burned through around 3 billion tokens, mostly cached, over about two days. It was mostly one-shot... except for the part where Claude Code crashed about 3/4 of the way through. I prompted it to read the previous context and continue work. The 6h limits also required manual restarts when auto-resume didn't trigger. During the creation of the site, the agent collected around 370 sources, including research papers and design reports, compiling them into [12 research dossiers](https://github.com/Linked-Liszt/aps_viz/tree/main/research).

I was impressed by the initial output. Skimming through the descriptions of techniques I was familiar with, they seemed fairly correct. The low-poly instruments and optics assemblies had a certain charm, and the interactive technique explanations were fun to fiddle with. Because of the low-stakes nature of the work, this is the most "just send it" leeway I've given a model. I'm surprised at the sheer scale and coherence of what it had researched and built.

At this point, I decided to polish it up for public release. The main change was deduplicating writing between a "visitor" and "expert" mode feature the model had created. I had 6.1 Sol dedup the modes and take a polish pass at the writing with Cursor's [unslop prompt](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md) to try to get some of the Claude-isms out (some of which I find a bit grating).

Not sure if I have any big statements to conclude with. In my day-to-day I wear a lot of hats. Tools like these seem well suited to assist with rapidly prototyping new ideas/experiments/projects. (And beyond this, I've been following and am excited for autoresearch, AI-driven experiments, and the recent findings in frontier mathematics.) At the end of the day, I hope people have fun exploring the site and come away a little curious at what goes on at the APS.
