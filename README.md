# OrPAD Package Registry

This repository is the official package registry consumed by OrPAD Package Manager.

Canonical registry index:

```text
https://raw.githubusercontent.com/OrPAD-Lab/orpad-registry/main/registry/packages.json
```

Compatibility registry index:

```text
https://raw.githubusercontent.com/OrPAD-Lab/orpad-registry/main/registry/node-packs.json
```

The legacy `registry/node-packs.json` path remains published as a compatibility
alias for OrPAD builds that already shipped with that URL.

## How Sharing Works

OrPAD does not let arbitrary uploads become official packages. Contributors submit package metadata through pull requests. Maintainers review the source repository, manifest, declared capabilities, checksums, and review metadata before merge. Only merged entries in `registry/packages.json` are treated as the official OrPAD registry by Package Manager.

The current registry contract still uses the legacy `nodePackRegistry` schema id because OrPAD package manifests can contribute node types. A package can also include reusable graphs, skills, rules, templates, and supporting assets, so the public name is **Package Registry**.

Custom registry URLs still work in OrPAD, but the app labels them as custom discovery sources unless a user or workspace explicitly trusts them.

## Submit A Package

1. Publish the package source in a public HTTPS Git repository.
2. Pin the package to an immutable tag or commit in the registry entry.
3. Generate a registry entry draft from the OrPAD app repository:

```powershell
node bin/orpad-cli.mjs packages registry-entry create <package-folder> `
  --source-repository https://github.com/<owner>/<repo> `
  --source-ref <tag-or-commit> `
  --manifest-url https://raw.githubusercontent.com/<owner>/<repo>/<tag-or-commit>/orpad.node-pack.json `
  --json
```

4. Add or update the entry in `registry/packages.json` and keep `registry/node-packs.json` as the compatibility alias.
5. Open a pull request using the package submission template.
6. Run validation before pushing:

```powershell
npm run validate
```

Maintainers add the final `review.status: "approved"` metadata after review. A package is not official until the PR is approved, CI passes, and the entry is merged.

## Files

- `registry/packages.json`: the public registry index.
- `registry/node-packs.json`: compatibility alias for shipped OrPAD builds.
- `schemas/package-registry.schema.json`: schema for registry metadata shape.
- `schemas/node-pack-registry.schema.json`: compatibility schema alias.
- `scripts/validate-registry.mjs`: no-dependency policy validator used by CI.
- `REGISTRY_POLICY.md`: review and acceptance policy.
