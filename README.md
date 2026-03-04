# Envoyer Organizer

Extensao do Chrome (Manifest V3) para organizar os servicos do Envoyer no dashboard. Ela agrupa os projetos em Production e Sandbox, cria accordions por time nos sandboxes e permite filtrar por nome e time.

## Instalacao (modo desenvolvedor)

1. Abra `chrome://extensions`
2. Ative o modo desenvolvedor
3. Clique em "Load unpacked" e selecione esta pasta
4. Abra https://envoyer.io/dashboard e recarregue a pagina

## Funcionalidades

- Agrupa os projetos em Production e Sandbox.
- Sandbox vira um accordion pai, com accordions por time.
- Production tem apenas um accordion pai e lista os grupos por servico.
- Filtro por nome do servico e por time.
- Opcao de desativar a organizacao (com botao flutuante para reativar).
- Definicao de regex para identificar sandboxes e times.

## Como usar

- O painel aparece no topo do dashboard.
- Digite no campo de busca para filtrar por nome.
- Selecione um time no filtro para ver somente aquele grupo (ou Production).
- Clique em "Disable organizer" para voltar ao layout original.

## Padroes iniciais

- Regex de sandbox: `\[SANDBOX\]`
- Regex de time: `-([a-z])-` (grupo de captura 1)
