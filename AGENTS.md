# Development instructions

- Respond in Japanese unless the user requests another language.
- Use superpowers skills only when explicitly requested by the user.
- Keep production dependencies at zero. Development dependencies are allowed.
- Build the npm package before distribution; users must not need a build step.
- Read project files only. All file and HTML asset routes must use the same root validation.
- Preserve the attribution for the fuzzy search implementation in THIRD_PARTY_NOTICES.md.
- Run `npm test` and `npm run test:browser` before reporting implementation complete.
