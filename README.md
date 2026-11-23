# Express Entregas · V3.0

Repositório do site, cadastro, rastreio, módulos compartilhados e backend Firebase do candidato local `3.0.0`.

## Estrutura

- `www/`: aplicação web compilada, PWA, cadastro, módulos e assets.
- `marketing/`: fonte das páginas públicas de cadastro.
- `tracking/` e `public-tracking/`: fonte e build do rastreio público.
- `browser/`: módulos compartilhados de clientes e avisos.
- `functions/`: comandos e serviços do backend.
- `database.rules.json`: regras de acesso do Realtime Database.
- `tests/`: suítes backend, browser e regras.

## Build e testes locais

Requer Node.js 22 ou superior. Instale as dependências e gere os assets com:

```sh
npm ci
npm ci --prefix functions
npm ci --prefix tests/firebase-rules
npm run check
npm run build:web
npm test
npm run test:rules
npm run test:browser
```

O teste browser usa Auth e Realtime Database em emuladores locais. `www/firebase-config.js` é configuração local e fica ignorado pelo Git; o build pode gerar uma cópia baseada no exemplo. O exemplo contém apenas configuração cliente do projeto de testes, não credenciais privadas. Confirme o isolamento do projeto hospedado antes de usar qualquer configuração remota.

## Prévia web

O GitHub Pages publica uma prévia em <https://fmrpbr.github.io/express3.0/> a partir da pasta `www/`. O workflow compila os assets e usa a configuração Firebase do projeto de testes `express-entregas-2-testes`; esta publicação não configura nem altera o Firebase de produção.

O site e o repositório são públicos. Não inclua credenciais privadas, dados reais ou arquivos `.env` neste repositório. A integração de push web permanece sem chave VAPID.

`firebase.json` segue sem destino Hosting: o deploy de páginas está limitado ao GitHub Pages e não executa deploy de Functions nem de regras.

## Limite da candidata

Esta cópia contém o site e backend V3.0, não contém APK, projeto Android ou credenciais. Integrações de iFood, Aiboo e pede.ai permanecem sem adapters validados. Consulte `docs/homologacao/STATUS-CANDIDATO-V3.0-RC1-2026-11-22.md` para os testes e pendências externas.
