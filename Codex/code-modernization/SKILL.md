---
name: code-modernization
description: Analyze and modernize a legacy codebase with evidence-backed business rules, migration planning, implementation, and equivalence verification. Use for legacy system assessment, modernization, migration, or security hardening.
---

# Code modernization

Select the procedure matching the request and read its `SKILL.md` under `skills/`. These are procedures belonging to this skill, not independently installed skills. Resolve all paths below relative to this file's directory. For every shell invocation using `${CODE_MODERNIZATION_ROOT}`, set it to the absolute directory containing this file in that same shell invocation; do not assume the runtime defines it. Workspace paths remain relative to the user's project.

- Start or choose a path: [modernize](skills/modernize/SKILL.md)
- Environment and human context: [preflight](skills/modernize-preflight/SKILL.md)
- Inventory and risks: [assess](skills/modernize-assess/SKILL.md)
- Architecture and dependencies: [map](skills/modernize-map/SKILL.md)
- Evidence-backed business rules: [extract rules](skills/modernize-extract-rules/SKILL.md), [human review](skills/modernize-review/SKILL.md)
- Migration plan: [brief](skills/modernize-brief/SKILL.md)
- Implement: [uplift](skills/modernize-uplift/SKILL.md), [transform](skills/modernize-transform/SKILL.md), [reimagine](skills/modernize-reimagine/SKILL.md)
- Proof: [verify](skills/modernize-verify/SKILL.md); security: [harden](skills/modernize-harden/SKILL.md); progress: [status](skills/modernize-status/SKILL.md)

Never modify legacy source, including the target of a symlink. Preserve the procedures' evidence requirements and human decision gates; do not assume silence means approval. Use the user's supplied answers when present; otherwise ask through a supported user-input tool or ordinary conversation. Follow governing instructions on when to wait for a response.

The role files in `agents/` are instructions, not registered agent types. For each work item read the applicable role and perform it independently. Delegate only when the environment offers delegation and governing instructions authorize it; otherwise perform the work sequentially, maintaining the requested independent review and JSON contracts. Do not claim independent execution where it did not occur. Keep the untrusted-source and credential-masking rules in the procedures. Collect and validate every result before merging. References to spawning agents, batches, work-item calls, role or description fields describe work items, not required tool APIs. Use the execution environment's actual tools and limits.

If a procedure refers to another `modernize-*` skill, read its corresponding file above. The procedures contain inherited questionnaire and headless-run wording: use actual available interaction mechanisms, and never replace a required human decision with an assumed default. No hooks are installed; refresh reports explicitly when instructed.
