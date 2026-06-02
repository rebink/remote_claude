---
title: Why a remote agent?
description: When this beats running Claude Code locally, and when it doesn't.
---

## When this is the right tool

You'll get the most out of Patchwire when at least two of these are true:

- Your laptop is the smaller machine. A desktop Mac (or Linux box) on the same network has more RAM, more cores, and better thermals.
- Your Claude Code sessions involve large repos where the model needs full project context, and indexing or reading hits noticeable disk and memory.
- You regularly run the laptop on battery and would rather not turn AI work into a heat-and-fan event.
- You want to iterate locally on the result (run, debug, hot-reload) at native filesystem speed instead of over a remote filesystem.
- You like the review gate. Every change comes as a diff you can inspect before it touches your tree.

## When it's overkill

- You only have one machine. Just use Claude Code locally.
- Your project is small and fits comfortably in your laptop's working set.
- You need real-time AI co-editing inside your IDE. Patchwire is request/response, not co-pilot.
- You can't run the agent persistently somewhere. If there's nowhere to put it, there's nowhere to put it.

## Compared to other approaches

### vs. SSHFS / `code-server` / VS Code Remote-SSH

These mount or proxy a filesystem and run your editor (or part of it) remotely. They give you "the editor sees the remote project," which means filesystem operations cross the network for every keystroke. That's fine for typing. It's *not* fine for autocomplete, file watchers, build systems that scan thousands of files, or hot-reload.

Patchwire inverts the cost: everything stays local except the AI run. The only network operations per `ask` are one `rsync` (incremental) and one HTTP request. Your IDE never touches the wire.

### vs. running Claude Code over SSH

Mostly fine, but two issues:

1. You lose the local diff preview. Claude edits the remote tree directly, so by the time you `git diff` you're inspecting changes via SSH.
2. Re-syncing those changes back to your laptop for testing is a manual `rsync` or `scp` dance.

Patchwire gives you the diff *before* anything is applied locally, and the apply step is a normal `git apply` against your laptop's tree.

### vs. Dropbox / iCloud / Resilio Sync

Bidirectional file sync products are designed to *eventually agree*. Run two tools editing the same files at once and you get conflicts, ".sync-conflict-X.dart" files, and surprise deletions. We don't try. It's strictly one-way push at the moment of `ask`, and the agent always restores the tree before returning.

### vs. cloud AI runners

Hosted inference platforms are convenient but require shipping your code to a third party with whatever data policy that entails. Patchwire runs on your hardware and on your network. The only thing that leaves your network is whatever Claude Code itself sends to Anthropic, which is exactly what would happen if you ran `claude` on your laptop.

## The reviewability angle

This one is underrated.

When AI edits files in your tree directly, you have to *trust* it before reviewing. You might hot-reload, see it broke, then `git diff` to figure out what happened. By then you've already lost minutes (and possibly state) you can't easily get back.

Patchwire flips it: diff first, apply second. Every change is a unified diff with file-by-file selection. Apply only the bits you like. The rest is saved to `.patchwire/last.patch` for later. You can also hand the diff to a code reviewer or a CI bot before it ever touches your branch.

## Practical numbers

Anecdotally, on a Flutter project with about 1k tracked files:

- First sync: 2 to 5 seconds on LAN, 5 to 15 seconds over Tailscale (depending on the link).
- Incremental sync (no changes): under 500ms.
- Claude run: dominated by the prompt itself (seconds to minutes, same as local).
- Diff transport: usually a few KB.

The wire never becomes the bottleneck on a sane network.
