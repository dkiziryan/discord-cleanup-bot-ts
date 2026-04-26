# AI Contributor Instructions

## Approval Rules
- Do not create commits unless I explicitly ask you to commit.
- Do not push code unless I explicitly ask you to push.
- Do not stage files, create branches, open pull requests, or run destructive git commands unless I explicitly ask for that action.
- If a task seems to require committing, pushing, deleting files, rewriting history, or changing deployment/configuration state, stop and ask first.

## Verification
- Always test changes before handing work back.
- Prefer the narrowest relevant test first, then run broader checks when the change affects shared behavior.
- Run `npm test` from the repository root before handing back code changes when practical. This is the canonical test command and includes backend tests plus frontend tests.
- For build-sensitive frontend changes, also run `npm run build:web` from the repository root when practical.
- If tests cannot be run because of missing services, credentials, network access, environment setup, or time constraints, say exactly what was not run and why.
- Do not claim a change is safe unless it has been tested or the remaining risk is clearly described.

## Code Organization
- Keep files focused and reasonably sized. Avoid creating or expanding very large files; if a file is approaching hard-to-review size, split it into smaller modules.
- Do not put unrelated responsibilities in one file. Separate concerns into clear directories, components, services, models, types, utilities, and tests.
- Prefer typed models and explicit interfaces for shared data shapes.
- Keep business logic out of UI components when it can live in services, hooks, or utilities.
- Keep route/API handling, validation, persistence, and domain logic separated unless the existing codebase clearly uses a different pattern.
- Match the existing project structure before introducing new folders or abstractions.

## Change Discipline
- Make the smallest coherent change that solves the problem.
- Avoid unrelated refactors, formatting churn, dependency changes, and generated-file noise.
- Read the surrounding code before editing so changes fit local naming, style, and architecture.
- Preserve existing behavior unless the task explicitly asks to change it.
- Add or update tests for meaningful behavior changes.

## Communication
- Before making risky or broad changes, explain the plan briefly.
- When finished, summarize what changed, what tests ran, and any remaining risks or follow-up work.
