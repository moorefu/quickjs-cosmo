# Release profiles (issue #5)

The default build and runtime download are **base-fat**. `full` adds Zstandard,
LZ4 Frame and bzip2; neither unsupported exports nor their native implementations
belong in base. Both profiles retain verified zlib, networking, TLS and Fetch.

## Implementation sequence

1. Select `base`/`full` independently of the pinned Nightly toolchain. Isolate
   build objects, filter JS exports, declarations and capabilities together, and
   verify that base archives contain no optional codec symbols.
2. Replace the two embedded PEM arrays with one APE ZIP resource,
   `/zip/.quickjs-cosmo/ca-bundle.pem`. Link this resource automatically into qjs,
   qjsc outputs and SDK applications. Expose a process-scoped, immutable CA
   provider configuration for embedders; copy provider bytes before pump threads
   use them. Missing or invalid resources fail closed. Preserve extra-CA merging.
3. Produce fat and independently linked x64/arm64 runtime variants. Runtime ZIPs
   contain only `qjs` and `readme.txt`. Separate SDK and test packages include
   their dependencies, licenses and profile-specific contracts.
4. Bind evidence to profile, architecture, executable and capability hashes.
   Measure executable slices, ZIP members and download sizes. Enforce the issue's
   decimal-byte targets with an explicit fixed 200,000-byte engineering margin.
5. Run both fat profiles on all seven existing hosts, retain the actual ARM64
   64K-page gate, and execute each single-architecture runtime on a representative
   host. Aggregate both profiles before publishing any release assets.

## Artifact contract

Keep the existing VERSION scheme. Publish `quickjs-cosmo-VERSION.zip`,
`quickjs-cosmo-full-VERSION.zip`, `quickjs-cosmo-{x64,arm64}-VERSION.zip`,
`quickjs-cosmo-full-{x64,arm64}-VERSION.zip`, and separate
`quickjs-cosmo-{sdk,tests}-VERSION.zip`, with checksums and machine-readable
metadata. The SDK carries both profiles under separate directories.

## Validation

Profile tests check export absence, positive/negative declarations, compiled and
SDK entries, CA contents/deduplication/provider behavior, and TLS verification.
Full retains every existing codec regression. Base exercises zlib/CRC, QJB,
HTTP content coding, TLS, Fetch and Node differential contracts. Packaging tests
reject profile/hash/resource/layout/size mismatches. Complete local checks before
commit and require all CI platform checks and the aggregate gate after push.
