# Releasing xbird

`xbird` is distributed directly from GitHub.

## Checklist

1. Update `package.json` version and `CHANGELOG.md`.
2. Run the release gate:

```bash
bun install
bun run lint
bun run test
bun run build
```

3. Verify GitHub-source installation in a temporary environment.
4. Tag the release and create a GitHub release:

```bash
git tag v<version>
git push origin v<version>
```

5. Include changelog notes in the GitHub release.

## Optional standalone binary

Build the Bun-compiled binary:

```bash
bun run binary
./xbird --version
```

Package it for the GitHub release:

```bash
tar -czf xbird-macos-universal-v<version>.tar.gz xbird
shasum -a 256 xbird-macos-universal-v<version>.tar.gz
```

## Optional Homebrew tap

Update `panda850819/homebrew-tap/xbird.rb` with:

```ruby
url "https://github.com/panda850819/xbird/releases/download/v<version>/xbird-macos-universal-v<version>.tar.gz"
sha256 "<calculated_sha>"
version "<version>"

install do
  bin.install "xbird"
end
```

Use a minimal version check in the formula test. Keep installation, configuration, and authentication documentation synchronized with `README.md`.
