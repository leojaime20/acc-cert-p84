# ACC Cert

Aplicação web responsiva para inspeções e certificação diária de áreas de obra. A primeira base de dados contempla o projeto P84, seus cinco modelos MCCR e as áreas fornecidas para certificação.

## Requisitos

- Node.js 22 ou superior
- npm
- Firebase CLI
- projeto Firebase com Authentication, Firestore e Storage habilitados

## Desenvolvimento local

1. Instale as dependências com `npm install` e `npm --prefix functions install`.
2. Copie `.env.example` para `.env.local` e preencha a configuração pública da aplicação web Firebase.
3. Execute `npm run dev`.

O projeto utiliza `HashRouter`, portanto funciona no GitHub Pages sem regras de reescrita de URL.

## Firebase

Copie `.firebaserc.example` para `.firebaserc` e informe o ID do projeto. Para trabalhar sem dados reais, execute `npm run firebase:emulators`.

As regras são fechadas por padrão. Nenhum usuário autenticado acessa dados sem um perfil ativo na coleção `users`. Alterações administrativas e finalização de inspeções passam pelo backend.

### Carga inicial do P84

A carga é idempotente: documentos conhecidos são atualizados sem apagar coleções ou dados de outros projetos.

Valide os arquivos de origem sem acessar o Firebase com `npm run seed:p84:dry-run`.

```sh
export FIREBASE_PROJECT_ID="seu-projeto"
export GOOGLE_APPLICATION_CREDENTIALS="/caminho/para/service-account.json"
npm run seed:p84
```

São carregados:

- projeto `P84`;
- 374 áreas certificáveis;
- checklists `MCCR-A-01` a `MCCR-A-05`;
- 108 itens, preservando a numeração original;
- `OMB04-A` e `OMB04-B`, ambos com `sourceCode: OMB04`;
- referências `SF-001` a `SF-006` nos metadados, sem tratá-las como áreas enquanto não houver checklist associado.

### Primeiro administrador

O administrador inicial é criado por um script privilegiado e sua senha não é gravada no repositório.

```sh
export FIREBASE_PROJECT_ID="seu-projeto"
export GOOGLE_APPLICATION_CREDENTIALS="/caminho/para/service-account.json"
export INITIAL_ADMIN_EMAIL="admin@empresa.com"
export INITIAL_ADMIN_NAME="Administrador"
export INITIAL_ADMIN_PASSWORD="uma-senha-forte"
npx tsx scripts/create-initial-admin.ts
```

## Verificações

```sh
npm run format:check
npm run lint
npm test
npm run build
npm --prefix functions run build
firebase emulators:exec --only firestore,storage "npm test"
```

## Administração e dados para dashboards

Usuários com perfil `admin` possuem uma central exclusiva para:

- cadastrar e ativar inspetores ou visualizadores por e-mail;
- reenviar a mensagem de definição de senha e desativar acessos;
- pesquisar e abrir todos os relatórios PDF gerados;
- gerar um pacote ZIP consolidado para Excel e Power BI.

O pacote contém `dados/inspecoes_itens.csv`, com uma linha por item de checklist,
`dados/manifesto_imagens.csv`, as fotografias organizadas em
`imagens/INSPECAO/ITEM/` e os PDFs disponíveis em `relatorios/`.

## Deploy

O frontend é publicado pelo workflow `.github/workflows/deploy-pages.yml`. As variáveis `VITE_FIREBASE_*` devem ser cadastradas como _Actions Variables_ no repositório GitHub.

O backend é publicado separadamente com `firebase deploy --only firestore,storage,functions`. Cloud Functions pode exigir que o projeto Firebase esteja no plano de faturamento apropriado.

## Situação funcional

Esta entrega cobre a fundação prevista na especificação: estrutura React/TypeScript, autenticação, rotas protegidas, listagem responsiva de áreas, modelos de dados, validações básicas, regras, Functions de finalização/relatório, carga inicial e deploy. A criação e o preenchimento de inspeções, fotografias, documentos e telas administrativas entram nas próximas entregas incrementais.
