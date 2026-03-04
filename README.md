# Envoyer Organizer

Extensao do Chrome (Manifest V3) para organizar os servicos do Envoyer no dashboard. Funciona nos modos de visualizacao em **cards** e em **lista**. Agrupa os projetos em Production e Sandbox, cria accordions por time nos sandboxes e permite filtrar por nome e time.

## Instalacao (modo desenvolvedor)

1. Abra `chrome://extensions`
2. Ative o modo desenvolvedor
3. Clique em "Load unpacked" e selecione esta pasta
4. Abra https://envoyer.io/dashboard e recarregue a pagina

## Funcionalidades

- Suporte aos dois modos de visualizacao do Envoyer: cards e lista.
- Agrupa os projetos em Production e Sandbox.
- Sandbox tem accordions por time (letra extraida via regex).
- Production agrupa por prefixo do nome do servico.
- Filtro por nome do servico e por time.
- Nomes de times: mapeie uma letra (ex: `I`) para um nome legivel (ex: `App`). O nome aparece nos accordions e no filtro.
- Opcao de desativar a organizacao (com botao flutuante para reativar).
- Configuracao de regex para identificar sandboxes e times.
- Configuracoes e mapeamentos persistidos via `chrome.storage.local`.

## Como usar

- O painel aparece no topo do dashboard.
- Digite no campo de busca para filtrar por nome.
- Selecione um time no dropdown para ver somente aquele grupo (ou Production).
- Clique em "Disable organizer" para voltar ao layout original do Envoyer.
- Em **Settings**, configure os regex de sandbox e time.
- Em **Team names**, selecione uma letra detectada, informe o nome e clique em "Add". Para editar, altere o campo diretamente. Para remover, clique em `x`.

## Padroes iniciais

- Regex de sandbox: `\[SANDBOX\]`
- Regex de time: `-([a-z])-` (grupo de captura 1 vira a letra do time, ex: `-i-` → `I`)
