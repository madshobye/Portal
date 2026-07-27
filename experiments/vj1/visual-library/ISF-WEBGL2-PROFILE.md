# VJ1 ISF WebGL2 profile

VJ1 owns a canonical shader dialect identified by:

```json
"VJ1": { "PROFILE": "vj1-isf-webgl2@1" }
```

Library and installed ISF files must use this profile before entering the
runtime. The importer performs the mechanical conversion; the frame renderer
does not carry a legacy compatibility branch.

Project-owned legacy ISF files pass through the same canonicalizer when they
are ingested. This conversion is non-destructive: VJ1 derives a canonical node
source without rewriting the user's `.fs` or `.vs` file. Known mechanical
legacy forms are accepted; ambiguous metadata and unsupported GLSL still fail
at the boundary with a named migration error.

## Fragment source rules

- Target GLSL ES 3.00 and WebGL2.
- Write to `isf_FragColor`, not `gl_FragColor`.
- Use `texture()`, not `texture2D()`.
- Use `isf_FragNormCoord`, not `vv_FragNormCoord`.
- Do not include a `#version` directive; the host owns it.
- Do not declare the host varying `vTexCoord`.
- Do not define functions named `round` or `sign`; they conflict with GLSL ES
  3.00 built-ins.
- Global initializers must be constant expressions. Derive values from uniforms
  inside a function.
- A shader may include an optional same-stem `.vs` custom vertex stage. The
  repository manifest records it as `vertexResource`; installed node packages
  use `vertexResourceId`.

## Custom vertex source rules

- The vertex source must carry
  `/* VJ1_ISF_VERTEX_PROFILE: vj1-isf-webgl2@1 */`.
- Call `isf_vertShaderInit()` from the custom `main()`. The host implementation
  initializes the standard quad position, texture coordinate, normalized ISF
  coordinate, and content transform before custom deformation or varying work.
- Use GLSL ES 3.00 stage declarations: custom vertex varyings are `out`, and
  their matching fragment declarations are `in`.
- Do not declare `#version`, host attributes, host matrices, `vTexCoord`, or
  `isf_FragNormCoord`; the host owns those declarations.
- Legacy GLSL version branches are removed during import. Runtime compilation
  accepts only the canonical vertex marker and never performs compatibility
  rewriting in the frame loop.
- Custom vertex stages currently apply to generators and effects. Transitions
  retain their separate host-owned geometry contract and reject custom vertex
  stages.

Normal ISF metadata, inputs, passes, persistent targets, imported resources,
audio textures, FFT textures, and events remain host contracts. A transition
must have exactly `startImage` and `endImage`, one non-retained pass, and no
host-only audio/event input.

## Repository workflow

Import and canonicalize the pinned upstream repository:

```sh
node scripts/import-compatible-isf-library.mjs /path/to/ISF
```

Check that every repository shader and manifest entry is canonical:

```sh
node scripts/migrate-isf-webgl2-profile.mjs
```

Use `--write` only when intentionally migrating repository sources. Acceptance
also requires the Chrome architecture smoke: it compiles and links the entire
catalog with a real WebGL2 context and verifies balanced GPU resource disposal.

When an upstream fragment has a paired `.vs`, the importer canonicalizes and
writes both files atomically and the migration check validates both. Project
folders pair same-stem `.fs` and `.vs` files, while repository and installed
package manifests use their explicit resource references. The vertex source
hash is part of retained program identity, so source changes invalidate the
correct program without per-frame recompilation.

Files outside the profile stay on the explicit importer exclusion list until
their source is deliberately rewritten. They are not handled by runtime
fallbacks or per-shader patches.
