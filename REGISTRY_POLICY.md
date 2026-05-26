# OrPAD Registry Policy

The official OrPAD registry is a curated metadata index, not an open upload bucket. Packages become installable from the official registry only after maintainer review through `OrPAD-Lab/orpad-registry` pull requests.

## Trust Model

- Registry entries are accepted through pull requests only.
- Maintainers decide whether an entry can be merged.
- A merged entry means OrPAD maintainers reviewed the registry metadata and the submitted source reference.
- Registry review does not make third-party code OrPAD-owned code.
- Custom registries are treated as discovery metadata unless a user or workspace explicitly trusts them.

## Submission Requirements

Every registry entry must include:

- Stable `id`, `name`, `latestVersion`, and `versions`.
- Public HTTPS `sourceRepository`.
- Immutable `sourceRef`, preferably a release tag or commit SHA.
- HTTPS `manifestUrl` pointing to the exact source reference.
- Safe relative `manifestPath` and optional `sourceRoot`.
- `checksums.manifestSha256` for the manifest.
- SHA-256 checksums for declared files when the pack includes external declared assets.
- Declared `capabilities`, `nodeTypes`, `author`, `license`, `keywords`, and useful links when available.
- Maintainer review metadata before merge:
  - `review.status: "approved"`
  - `review.reviewId`
  - `review.reviewedBy`
  - `review.reviewedAt`
  - `review.approvedCapabilities`

## Review Checklist

Maintainers should reject or request changes when a package:

- Uses mutable source references for an official registry entry.
- Hides downloads, install steps, lifecycle scripts, native builds, or generated code not represented in the manifest.
- Declares high-risk capabilities without a clear use case and explicit approval.
- Reads, writes, or transmits workspace data beyond the declared capability scope.
- Tries to impersonate OrPAD, another maintainer, or another package.
- Lacks a usable license or source repository.
- Fails registry validation or package manifest validation.

## Merge Rules

Before merge:

1. CI must pass.
2. A maintainer must review the source repository and registry diff.
3. The latest registry version must include approved review metadata.
4. Any high-risk capability must be explicitly listed in `review.approvedCapabilities`.

After merge, OrPAD Package Manager can display the entry as official registry metadata when it is loaded from the default OrPAD-Lab registry URL.

## Updates And Removal

Package updates follow the same pull request and review flow as new packages. Maintainers may remove, de-list, or supersede entries when a package becomes unsafe, abandoned, misleading, broken, or incompatible with current OrPAD releases.

## Security Reports

Report sensitive package or registry issues privately to OrPAD maintainers before opening a public issue. If a package is actively harmful, maintainers should remove the entry first and publish details after users have a safe update path.

