# AGENTS.md

This project's AI/agent context lives in [`CLAUDE.md`](./CLAUDE.md). It documents
the architecture, the non-negotiable invariants (signature verification, dedup,
the 3-second window, no-silent-loss, no-secret-exposure), conventions, and
gotchas.

Agents working in this repo should read `CLAUDE.md` first and preserve those
invariants — they encode the reliability/security requirements this project is
graded on.
