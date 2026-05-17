# Obsidian Community Plugins — Submission Checklist

## Pre-Submission Status ✅

- ✅ All Obsidian submission requirements met
- ✅ Build passes Docker validation
- ✅ manifest.json: minAppVersion 0.18.0, isDesktopOnly false, description 60 chars
- ✅ No desktop APIs used (Obsidian SDK only)
- ✅ Keywords: ["url", "import", "crawler", "web-to-markdown", "web-clipper"]
- ✅ GitHub Actions release workflow configured
- ✅ versions.json all pointing to 0.18.0

---

## Step 1: Create Release Tag

```bash
cd /home/tobias/Developer/obsidian-url-importer-add-on

# Tag the release
git tag -a v1.8.6 -m "URL Importer Add-on v1.8.6 — Production release"

# Push tag to GitHub (triggers release workflow)
git push origin v1.8.6
```

This will automatically:
1. Trigger `.github/workflows/release.yml`
2. Build the plugin
3. Create GitHub release with main.js, manifest.json, styles.css attached

---

## Step 2: Verify Release

Go to: https://github.com/tobiasquinteiro/obsidian-url-importer-add-on/releases

Confirm:
- Release v1.8.6 created
- Artifacts attached: main.js, manifest.json, styles.css
- Copy the release page URL

---

## Step 3: Submit to Community Plugins

1. Go to: https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
2. Fill the form:
   - **Repository**: `https://github.com/tobiasquinteiro/obsidian-url-importer-add-on`
   - **Release**: v1.8.6
   - **Description**: "Add-on plugin focused on URL import workflows for Obsidian."
   - **Author**: Tobias Quinteiro
   - **Release notes**: (optional) "Production release with URL crawling, HTML→Markdown, image downloading, and graph connection support."

3. **Submit** and wait for review (~1–2 weeks)

---

## Release Notes Template (optional)

```markdown
## v1.8.6 — Production Release

### Features
- **URL Crawling**: Configurable depth and page limits with regex filtering
- **HTML→Markdown**: Smart content extraction with MIME-aware conversion
- **Image Downloading**: Automatic asset management with Obsidian attachment locations
- **Graph Preservation**: Internal link rewriting for seamless note integration
- **Settings Defaults**: 11 URL import options in plugin settings tab

### Improvements
- Reduced modal complexity: 3 fields (URL, filename, output folder)
- Advanced settings moved to dedicated Settings tab
- Obsidian 0.18.0+ compatibility
- SEO-friendly keywords for discoverability

### Quality
- Fully compliant with Obsidian submission guidelines
- No desktop-only APIs (web-safe)
- Minimal dependencies (Obsidian SDK only)
- TypeScript strict mode, ESLint validated

```

---

## Timeline

| Step | Estimated Time |
|------|---|
| Tag + Push | 2 minutes |
| GitHub Actions build | ~1 minute |
| Verify release | 2 minutes |
| Submit form | 5 minutes |
| Review queue | 7–14 days |
| **Total (excluding review)** | **~10 minutes** |

---

## Support

If submission is rejected:
1. Check feedback against Obsidian guidelines
2. Make requested changes
3. Re-tag with v1.8.7 (or next patch)
4. Resubmit

---

**Status**: Ready to ship 🚀
