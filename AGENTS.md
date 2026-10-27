# Development instructions

- Respond in Japanese unless the user requests another language.
- Use superpowers skills only when explicitly requested by the user.
- Keep production dependencies at zero. Development dependencies are allowed.
- Build the npm package before distribution; users must not need a build step.
- Read project files only. All file and HTML asset routes must use the same root validation.
- Preserve the attribution for the fuzzy search implementation in THIRD_PARTY_NOTICES.md.
- Run `npm test` and `npm run test:browser` before reporting implementation complete.

## Releases

- Tag and publish to npm only when explicitly asked to release; ordinary pushes do not trigger releases.
- If no version is specified, use patch for fixes and minor for new features; confirm breaking changes first.
- Before releasing, sync with the remote, verify npm authentication, and ensure the version and tag are unused.
- Update `package.json`, `package-lock.json`, `src/shared.ts` (`VERSION`), and README version examples. Run `npm run format:check`, `npm test`, `npm run test:browser`, and `npm pack --dry-run` in order. Commit, create an annotated `vX.Y.Z` tag matching the package version, push the commit and tag, then run `npm publish --access public` locally.
- Verify the remote tag and npm version / `latest` after publishing.
