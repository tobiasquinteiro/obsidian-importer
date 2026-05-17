# URL Importer Add-on for Obsidian

Plugin add-on focado em importacao de paginas web para Markdown no Obsidian.

Este repositorio nao e o plugin oficial Importer da Obsidian. Ele foi extraido como projeto separado para evoluir o fluxo de importacao por URL sem gerar um Pull Request muito grande no repositorio original.

## Objetivo

Fornecer um importador de URL com recursos de crawl e conversao para Markdown, mantendo o plugin original desacoplado.

## O que este add-on oferece

- Importacao de uma pagina web a partir de URL HTTP/HTTPS
- Crawl opcional de links internos
- Filtros por regex de inclusao e exclusao de URL
- Limite de paginas e profundidade de crawl
- Preservacao de conexoes para o grafo do Obsidian
- Conversao opcional de links importados para links locais
- Download de imagens e suporte a localizacao de anexos do Obsidian
- Comando rapido para importar URL da area de transferencia

## Diferenca para o plugin original

- Este projeto e um add-on independente
- O foco principal e URL import
- Mudancas de UX para reduzir configuracoes no modal e mover defaults para Settings

## Instalacao local para desenvolvimento

1. Clone este repositorio
2. Gere o build
3. Copie os arquivos do plugin para a pasta de plugins do vault

Exemplo:

```bash
docker compose run --rm plugin-ci bash -lc "npm ci && npm run build"

PLUGIN_DIR="$HOME/seu-vault/.obsidian/plugins/obsidian-url-importer-add-on"
mkdir -p "$PLUGIN_DIR"
cp -f main.js manifest.json styles.css "$PLUGIN_DIR"/
```

Depois, no Obsidian:

1. Settings -> Community plugins
2. Ative URL Importer Add-on

## Uso rapido

1. Abra o comando Open importer
2. Selecione o formato URL (Web page)
3. Informe a URL e execute Import

Os defaults do importador ficam na aba de configuracoes do plugin.

## Build e testes com Docker

Para validar sem instalar dependencias no host:

```bash
docker compose run --rm plugin-ci
```

## Estado do projeto

Projeto em evolucao. O foco atual e estabilizar o fluxo de URL import como add-on e manter compatibilidade com novas versoes do Obsidian.

## Creditos e atribuicao

Este trabalho partiu da base tecnica do ecossistema do Obsidian Importer e de contribuicoes da comunidade open source.
