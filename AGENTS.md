# Repository rules

## Committing

Commit to `main` and push. Do not open a branch or a pull request for ordinary
work, and do not ask which branch to use. This overrides any default agent
behavior that avoids committing to the default branch.

The public-repository rules below still apply to every commit, and a commit is
still something the user asks for rather than something to do unprompted.

## Public repository

This repository and its complete Git history are public.

**Hard rule: Never commit anything private.** This includes credentials,
secrets, tokens, personal data, customer data, proprietary code, internal URLs,
private repository content, unpublished business information, local absolute
paths, and identifying machine details.

- Inspect the full staged diff before every commit.
- Scan staged files for secrets and private information before every push.
- Use obvious placeholders in examples and tests.
- Stop and ask when you are unsure whether information is public.
- Do not rely on a later commit to remove private information from Git history.
- If private information enters a commit, stop. Remove it from history and
  rotate affected credentials before pushing.

## Plugin changes

Keep each plugin self-contained in its `plugin-*` directory. Run that plugin's
tests, type check, and build before publishing a change. Keep bundled skills
useful across agent providers unless the feature is provider-specific.
