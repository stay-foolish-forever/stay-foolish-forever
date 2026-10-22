# AGENTS.md

Guidance for AI coding agents working in this repository. Assumes no prior knowledge of the project.

## Project overview

This is the personal homepage repository of **Lei Zhang (张耒)**, a Ph.D. student at Nanjing University. The repo serves two purposes:

1. **GitHub profile README** — the root `README.md` is the profile page for github.com/stay-foolish-forever. Only edit it when the profile itself should change.
2. **Personal website** — a static blog/homepage built with [Astro](https://astro.build), living in `site/`, deployed to a self-hosted server via GitHub Actions + rsync + Caddy.

The site itself is in **Chinese (`lang="zh-CN"`)**: UI strings, blog content, and most code comments in the custom components are Chinese. Commit messages and docs are in English. The site started from the official Astro blog starter template and was heavily customized (animated season/weather background, auto day/night theme, hidden drawer footer).

## Repository layout

```
├── README.md                  # GitHub profile README (not website docs)
├── logo.jpg                   # profile asset
├── deploy/
│   ├── Caddyfile              # Caddy config used on the server (bind-mounted into the container)
│   └── docker-compose.yml     # runs Caddy in Docker on the server (ports 80/443, cert volumes)
├── .github/workflows/
│   └── deploy.yml             # build + rsync deploy pipeline
└── site/                      # the Astro website (all app code lives here)
    ├── astro.config.mjs       # Astro config: site URL, MDX + sitemap integrations, Shiki themes
    ├── package.json           # Node >= 22.23.4 required
    ├── tsconfig.json          # extends astro/tsconfigs/strict + strictNullChecks
    ├── public/                # static files served as-is (favicons)
    └── src/
        ├── consts.ts          # SITE_TITLE / SITE_DESCRIPTION (Chinese)
        ├── content.config.ts  # blog content collection schema (Zod)
        ├── content/blog/      # Markdown/MDX posts (*.md, *.mdx)
        ├── pages/             # routes: index, about, blog/index, blog/[...slug], rss.xml.js
        ├── layouts/BlogPost.astro  # post layout; also reused by about.astro (centered prop)
        ├── components/        # BaseHead, Header, HeaderLink, Footer, FormattedDate,
        │                      # SeasonScene.astro + scene-gl.ts (animated background)
        ├── styles/global.css  # theme CSS variables (light/dark via [data-theme])
        └── assets/            # images optimized by astro:assets (sharp)
```

## Tech stack

- **Astro ^7** static site generator — no UI framework (no React/Vue/etc.); plain `.astro` components with TypeScript in frontmatter and inline `<script>` blocks.
- Integrations: `@astrojs/mdx`, `@astrojs/rss`, `@astrojs/sitemap`; `sharp` for image optimization.
- TypeScript strict mode (`astro/tsconfigs/strict` + `strictNullChecks`).
- Node.js **>= 22.23.4** (see `site/package.json` `engines`; required by Astro 7.4+. CI uses Node 22 with `check-latest`).
- No test framework, no linter/formatter config, no husky hooks. `package.json` also contains a non-standard `allowScripts` field (`esbuild: true`); npm itself ignores it.

## Build and dev commands

All commands run in `site/`:

| Command | Action |
| --- | --- |
| `npm install` / `npm ci` | install dependencies (CI uses `npm ci`) |
| `npm run dev` | dev server at `localhost:4321` |
| `npm run build` | production build to `site/dist/` |
| `npm run preview` | preview the production build locally |
| `npm run astro ...` | run Astro CLI subcommands |

**Dev server convention (from `site/AGENTS.md`, still in effect):** when an agent starts the dev server, use background mode —

```
astro dev --background
```

Manage it with `astro dev stop`, `astro dev status`, and `astro dev logs`.

**Verification:** there is no test suite. The standard check is `npm run build` — it must complete successfully (currently builds 4 pages plus `rss.xml` and `sitemap-index.xml`).

## Content model

- Blog posts live in `site/src/content/blog/` as `.md`/`.mdx` files. Frontmatter is validated by the Zod schema in `site/src/content.config.ts`:
  - required: `title` (string), `description` (string), `pubDate` (coerced to Date)
  - optional: `updatedDate`, `heroImage` (must reference an image under `src/assets/` via the `image()` schema helper — see the existing post's `'../../assets/hello-cover.png'`)
- Posts are sorted by `pubDate` descending; the home page shows the latest 5, `blog/index.astro` lists all.
- Dates render via `FormattedDate.astro` using `toLocaleDateString('sv-SE')` → `YYYY-MM-DD`.
- RSS feed: `src/pages/rss.xml.js` (`@astrojs/rss`, uses `context.site`).
- Code blocks use Shiki with dual themes `github-light`/`github-dark` and `defaultColor: false` (theme colors are driven by CSS, see `astro.config.mjs`).

## Architecture notes (custom features)

These are hand-built and non-obvious; read the code before changing them:

- **Day/night theme** (`BaseHead.astro`, `Header.astro`, `global.css`): theme is auto-selected by local hour (light 6:00–18:00, dark otherwise), applied as `data-theme` on `<html>` and re-checked every minute. The header toggle stores a manual override in `localStorage` keys `theme-override` / `theme-override-auto`, valid only until the next day/night boundary. Debug by appending `#day` or `#night` to the URL.
- **SeasonScene** (`components/SeasonScene.astro` + `components/scene-gl.ts`, ~2000 lines): a full-screen animated canvas background (seasons, weather, day/night palettes, forest/tent/campfire scene). Dynamic layer renders via WebGL2 with instanced buffers packed only on resize/season/weather/theme changes; static scenery is baked into an offscreen 2D canvas and uploaded as a texture. Falls back to a static 2D frame when WebGL2 is unavailable; capped at 30 fps; pauses when the tab is hidden; honors `prefers-reduced-motion`. Seasons rotate every 12 min, weather re-rolls every 3–8 min; debug constants `SEASON_OVERRIDE` / `WEATHER_OVERRIDE` at the top of the script.
- **Drawer footer** (`Footer.astro`): the footer sits at `z-index: -2` behind the scene canvas and is revealed by scrolling past the page bottom (wheel/touch/keyboard), which shifts the foreground up by `--footer-h`. It has an "arm" delay so inertial scrolling doesn't open it accidentally.
- **Header/footer** use frosted-glass styling (`backdrop-filter`) over the canvas; CSS variables (`--bg`, `--text`, `--muted`, `--border`, `--accent`, …) in `global.css` define both palettes.

## Code style guidelines

- Match the existing style: **tabs** for indentation, single quotes, TypeScript types/interfaces in frontmatter and scripts.
- Astro components keep page-specific styles in scoped `<style>` blocks; shared styles and theme variables go in `src/styles/global.css`.
- Site copy and UI strings are in Chinese; code comments in the custom scene/theme code are also mostly Chinese — new comments should follow the language of the surrounding code.
- Commit messages observed so far: short lowercase type prefix, e.g. `doc: update README`, `feat: ...`.
- VS Code recommendations (`.vscode/` in `site/`): `astro-build.astro-vscode`, `unifiedjs.vscode-mdx`.

## Deployment

- Pipeline: `.github/workflows/deploy.yml`. Triggers on push to `main` that touches `site/**` (or the workflow file), plus `workflow_dispatch`. Steps: checkout → setup Node 22 (npm cache keyed on `site/package-lock.json`) → `npm ci` → `npm run build` → `rsync -az --delete` `site/dist/` to the server over SSH.
- Required repo configuration: secret `DEPLOY_SSH_KEY` (private key with write access to the deploy dir); variables `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH` (optional `DEPLOY_PORT`, default 22).
- Live site: `https://learn-forever.xyz` (`www` redirects to the apex). Server: Tencent Cloud, Ubuntu 22.04. Caddy runs in Docker — `deploy/Caddyfile` and `deploy/docker-compose.yml` are installed on the server under `/var/homepage/`, with `/var/homepage/root` bind-mounted into the container at the same absolute path. The pipeline deploys as the dedicated `deploy` user (key-only SSH, no sudo). `root` in `deploy/Caddyfile` must equal `vars.DEPLOY_PATH`.

## Security considerations

- Never commit private keys or real server credentials; deploy auth lives only in GitHub Secrets/Variables listed above.
## Known gotchas

- Canonical domain is `learn-forever.xyz`, configured in `site/astro.config.mjs` (`site`) and `deploy/Caddyfile` — canonical URLs, the sitemap, and the RSS feed all derive from `site`, so keep both files in sync if the domain ever changes.
- `astro check` is **not** wired up (`@astrojs/check` is not installed); type safety comes from the build and editor tooling only.
- Changes outside `site/**` (e.g. the profile `README.md`) do not trigger deployment.
