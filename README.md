# URL Importer Add-on for Obsidian

## PT-BR

Plugin add-on focado em importacao de paginas web para Markdown no Obsidian.

Este repositorio nao e o plugin oficial Importer da Obsidian. Ele foi extraido como projeto separado para evoluir o fluxo de importacao por URL sem gerar um Pull Request muito grande no repositorio original.

### Objetivo

Fornecer um importador de URL com recursos de crawl e conversao para Markdown, mantendo o plugin original desacoplado.

### O que este add-on oferece

- Importacao de pagina web a partir de URL HTTP/HTTPS
- Crawl opcional de links internos
- Filtros por regex de inclusao e exclusao de URL
- Limite de paginas e profundidade de crawl
- Preservacao de conexoes para o grafo do Obsidian
- Conversao opcional de links importados para links locais
- Download de imagens com suporte a localizacao de anexos do Obsidian
- Comando rapido para importar URL da area de transferencia

### Diferenca para o plugin original

- Projeto independente (add-on)
- Foco principal em URL import
- UX ajustada para reduzir campos no modal e mover defaults para Settings

### Instalacao local para desenvolvimento

1. Clone este repositorio.
2. Rode o build.
3. Copie os arquivos do plugin para a pasta de plugins do vault.

```bash
docker compose run --rm plugin-ci bash -lc "npm ci && npm run build"

PLUGIN_DIR="$HOME/seu-vault/.obsidian/plugins/obsidian-url-importer-add-on"
mkdir -p "$PLUGIN_DIR"
cp -f main.js manifest.json styles.css "$PLUGIN_DIR"/
```

No Obsidian:

1. Settings -> Community plugins
2. Ative URL Importer Add-on

### Uso rapido

1. Abra o comando Open importer.
2. Selecione URL (Web page).
3. Informe a URL e execute Import.

Os defaults do importador ficam na aba de configuracoes do plugin.

### Build e testes com Docker

```bash
docker compose run --rm plugin-ci
```

### Estado do projeto

Projeto em evolucao. O foco atual e estabilizar o fluxo de URL import como add-on e manter compatibilidade com novas versoes do Obsidian.

### Creditos e atribuicao

Este trabalho partiu da base tecnica do ecossistema do Obsidian Importer e de contribuicoes da comunidade open source.

---

## EN

Add-on plugin focused on importing web pages into Markdown for Obsidian.

This repository is not the official Obsidian Importer plugin. It was extracted into a standalone project to evolve URL import workflows without creating a very large pull request against the original repository.

### Goal

Provide a URL importer with crawl and Markdown conversion capabilities while keeping the original plugin decoupled.

### What this add-on provides

- Import a web page from an HTTP/HTTPS URL
- Optional internal link crawling
- Include and exclude URL regex filters
- Page and crawl depth limits
- Optional graph connection preservation for Obsidian graph view
- Optional conversion of imported links into local note links
- Image download support integrated with Obsidian attachment placement
- Quick command to import URL from clipboard

### Difference from the original plugin

- Independent add-on project
- Main focus is URL import workflows
- UX changes to reduce modal fields and move defaults to Settings

### Local install for development

1. Clone this repository.
2. Run the build.
3. Copy plugin files to your vault plugins folder.

```bash
docker compose run --rm plugin-ci bash -lc "npm ci && npm run build"

PLUGIN_DIR="$HOME/your-vault/.obsidian/plugins/obsidian-url-importer-add-on"
mkdir -p "$PLUGIN_DIR"
cp -f main.js manifest.json styles.css "$PLUGIN_DIR"/
```

In Obsidian:

1. Settings -> Community plugins
2. Enable URL Importer Add-on

### Quick usage

1. Run the Open importer command.
2. Select URL (Web page).
3. Enter the URL and click Import.

Importer defaults are available in the plugin Settings tab.

### Build and test with Docker

```bash
docker compose run --rm plugin-ci
```

### Project status

This project is under active iteration. Current focus is stabilizing URL import as an add-on and keeping compatibility with new Obsidian versions.

### Credits and attribution

This work builds on the technical base of the Obsidian Importer ecosystem and open-source community contributions.
