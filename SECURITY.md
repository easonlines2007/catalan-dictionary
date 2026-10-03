# Dependency security

CI audits production dependencies and checks the application with lint,
TypeScript, build and tests. Run `npm audit` to include development tools.

As of 2026-10-03, the development-only Next.js ESLint plugin brings in
`braces@3.0.3` through fast-glob/micromatch. Its
[nesting-related denial-of-service advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
has no published patched version. It is not a production dependency and this
application does not pass web requests into that toolchain. Keep the toolchain
updated when a fix becomes available.
