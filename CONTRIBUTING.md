# Contributing

Thanks for helping improve the extension.

1. Create a focused branch and keep changes scoped to one behavior.
2. Preserve the core safety rules: only explicit exact `@name` matches, no prompt text deletion/replacement, one native candidate click per slot per run, and no automatic send.
3. Do not add analytics, remote code, broad host permissions, personal paths, recordings, user assets, generated release archives, or secrets.
4. Run `npm ci`, then `npm run check` and `npm test` before opening a pull request.
5. Update `CHANGELOG.md`, `PRIVACY.md`, and tests when behavior, storage, permissions, or data flow changes.

Bug reports should use synthetic filenames and redact account or project information. General feedback may be sent to [cs_svip@163.com](mailto:cs_svip@163.com); never send private assets, complete prompts, local paths, cookies, tokens, or other credentials.
