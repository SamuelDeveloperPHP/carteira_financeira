# Backlog — Carteira financeira

Status: implementado para demonstração Docker, incluindo os itens P1 (CF-16 e CF-17) e a recuperação de senha por link de 7 minutos (CF-04). Situação por item, evidências de testes e limitações em [docs/ENTREGA.md](docs/ENTREGA.md). Valores exclusivamente simulados.

Prazo informado: 3 dias. Contexto: desafio backend para vaga sênior.

## Objetivo

Entregar uma carteira demonstrável, com movimentações consistentes, autenticação em dois fatores e rastreabilidade, acompanhada de uma interface simples e de acesso administrativo para auditoria.

## Base acordada

- Frontend: Next.js e TypeScript, aproveitando o template existente.
- Implementação: frontend operacional isolado em `frontend/`, reaproveitando Bootstrap e fontes locais; template original em `src/` preservado sem seus mocks na execução Docker.
- Backend: NestJS sobre Node.js, com TypeScript, em `backend/`.
- Toda carteira começa com saldo zero.
- O saldo aumenta por transferências recebidas ou depósitos externos simulados e controlados.
- Nesta entrega, todos os saldos, depósitos, transferências e estornos representam valores simulados; não há movimentação em contas bancárias reais.
- A integração para movimentar dinheiro real será apresentada como evolução possível, ainda não implementada e fora do prazo de três dias.
- Transferências exigem saldo disponível suficiente.
- O destinatário pode devolver uma transferência recebida, desde que tenha saldo disponível suficiente; caso contrário, a devolução é recusada.
- Falhas durante a transferência exigem reversão automática de toda a operação.
- Segundo fator obrigatório no login, sem nova exigência para transferências ou estornos.
- Localização solicitada pelo frontend; negativa ou indisponibilidade não bloqueia o login.
- Perfil master para auditoria, com 2FA e consultas administrativas também auditadas.
- O master consulta dados; não movimenta valores, altera saldos ou apaga a trilha.

## Premissas propostas para implementação

- Uma moeda: BRL, com valores representados em centavos inteiros.
- E-mail único para cadastro e identificação do destinatário.
- Transferências para a própria carteira serão recusadas.
- Estorno integral, uma única vez, sempre associado à transferência original.
- Segundo fator por aplicativo autenticador (TOTP), com códigos de recuperação de uso único.
- Depósitos simulados em ambiente de demonstração, por mecanismo restrito separado do perfil master.
- Auditoria de operações, consultas relevantes e eventos de segurança processados pelo backend; não de cada clique na interface.

Essas premissas complementam o enunciado e devem constar na documentação da entrega.

## Prioridade e esforço

- **P0:** necessário para entregar o escopo acordado.
- **P1:** melhoria posterior à entrega funcional; continua no backlog.
- **P / M / G:** esforço relativo pequeno, médio ou grande, incluindo verificação do item. Não representam horas nem compromisso de prazo.

### Fundação e acesso

| ID | Prioridade | Item | Esforço | Depende de |
|---|---|---|---|---|
| CF-01 | P0 | Preparar backend, banco relacional, migrações e configuração | M | — |
| CF-02 | P0 | Cadastro e criação da carteira | M | CF-01 |
| CF-03 | P0 | Autenticação, sessões e autorização | G | CF-02 |
| CF-04 | P0 | Segundo fator e recuperação de acesso | G | CF-03 |

**CF-01 — Critérios de aceite**
- Backend separado da interface existente, com configuração de exemplo sem segredos.
- Modelo contempla usuários, carteiras, movimentações, estornos, sessões e eventos de auditoria.
- Migrações recriam a estrutura em banco vazio; valores e vínculos têm restrições de integridade.

**CF-02 — Critérios de aceite**
- Cadastro valida os dados, impede e-mail duplicado e armazena somente hash seguro da senha.
- Usuário e carteira com saldo zero são criados de forma atômica.
- Cadastro público não permite escolher o perfil master.

**CF-03 — Critérios de aceite**
- Login valida credenciais, limita tentativas e não revela se uma conta existe.
- Sessões expiram, podem ser encerradas e não concedem acesso completo antes do segundo fator.
- Usuários comuns acessam apenas suas contas; identidade do remetente vem da sessão.
- Rotas e cookies/tokens recebem proteções coerentes com a estratégia de sessão escolhida.

**CF-04 — Critérios de aceite**
- Primeiro acesso direciona ao cadastro do autenticador; a ativação exige um código válido.
- Sem concluir a ativação e o segundo fator, a conta não acessa funcionalidades financeiras.
- Login exige senha e código válido, com limite de tentativas e prevenção de reutilização do mesmo código aceito.
- Segredo TOTP é protegido em repouso; códigos de recuperação são armazenados como hashes e usados uma única vez.
- Troca ou remoção do autenticador exige reautenticação e não permite contornar o 2FA obrigatório.
- Recuperação de senha por link de uso único com validade de 7 minutos, resposta idêntica para contas existentes ou não, encerramento de todas as sessões e 2FA ainda obrigatório após a redefinição.

### Movimentação financeira

| ID | Prioridade | Item | Esforço | Depende de |
|---|---|---|---|---|
| CF-05 | P0 | Depósito externo simulado | M | CF-01, CF-03 |
| CF-06 | P0 | Transferência entre carteiras | G | CF-01, CF-03 |
| CF-07 | P0 | Devolução pelo destinatário | G | CF-06 |
| CF-08 | P0 | Consulta de saldo e extrato | M | CF-05, CF-06, CF-07 |

**CF-05 — Critérios de aceite**
- Mecanismo restrito de demonstração credita valor positivo e registra origem e referência.
- O usuário comum pode adicionar saldo simulado somente à PRÓPRIA carteira (saldo inicial), com teto por operação, limite de frequência, idempotência e auditoria; o master não pode e o operador local segue disponível para qualquer carteira.
- Repetir a mesma confirmação não credita novamente; o mecanismo de simulação fica desabilitado fora do ambiente previsto.
- Isola o mecanismo de depósito simulado das regras da carteira por uma interface de integração, permitindo acrescentar um provedor real futuramente sem tratar a simulação como confirmação bancária.

**CF-06 — Critérios de aceite**
- Valida destinatário, valor positivo, limites da representação monetária e saldo suficiente.
- Débito, crédito e registro financeiro são gravados na mesma transação.
- Falha em qualquer etapa desfaz a operação inteira.
- Requisições concorrentes não provocam saldo negativo nem gasto duplicado do mesmo saldo.
- Uma mesma solicitação repetida não transfere duas vezes; reutilizar sua identificação com dados diferentes é recusado.

**CF-07 — Critérios de aceite**
- Apenas o destinatário da transferência original pode iniciar a devolução integral ao remetente original.
- Saldo insuficiente causa recusa, sem alteração em nenhuma carteira.
- A transferência original permanece no histórico e recebe vínculo com a devolução.
- Repetição, concorrência ou nova tentativa não permitem devolver a mesma transferência duas vezes.
- A verificação de saldo e a devolução são atômicas, inclusive quando concorrem com outra saída.

**CF-08 — Critérios de aceite**
- Usuário consulta saldo disponível e extrato paginado da própria carteira.
- Extrato identifica depósitos, transferências enviadas e recebidas e devoluções, com valores, datas e referências.
- Histórico permite relacionar a transferência à sua devolução sem apagar lançamentos anteriores.

### Auditoria, localização e master

| ID | Prioridade | Item | Esforço | Depende de |
|---|---|---|---|---|
| CF-09 | P0 | Trilha central de auditoria e segurança | G | CF-01; integrar CF-02 a CF-08 |
| CF-10 | P0 | Localização do frontend e contexto do acesso | M | CF-03, CF-09 |
| CF-11 | P0 | Provisionamento e consultas do master | M | CF-04, CF-08, CF-09, CF-10 |

**CF-09 — Critérios de aceite**
- Registra cadastro, login, falhas, segundo fator, recuperação, logout, movimentações, recusas, alterações cadastrais/de segurança quando existentes e consultas relevantes.
- Cada evento contém identificador, horário do servidor, autor quando identificado, ação, recurso, resultado, motivo apropriado e identificador de correlação.
- Tentativas não autenticadas também são rastreáveis, sem depender de um usuário válido.
- Registros financeiros concluídos e sua evidência de auditoria não podem divergir; falhas e recusas continuam auditáveis após o rollback financeiro.
- Usuários e master não têm permissão para editar ou excluir eventos; o acesso de escrita da aplicação é restrito à inclusão na trilha.
- Não registra senhas, tokens, segredos TOTP, códigos de autenticação ou de recuperação.

**CF-10 — Critérios de aceite**
- Frontend solicita permissão de localização no fluxo de login e envia coordenadas, precisão e horário de captura quando disponíveis.
- Negativa, timeout ou indisponibilidade são registrados e não impedem a autenticação.
- Backend valida o formato recebido e associa o contexto ao acesso autenticado.
- IP é obtido no servidor; cabeçalhos encaminhados só são aceitos de proxies confiáveis.
- Registra informações disponíveis de navegador/dispositivo, sem afirmar que identificam um telefone de forma única.
- Localização é tratada como informação declarada pelo cliente, não como prova de identidade; a demonstração usa contexto compatível com geolocalização, como localhost ou HTTPS.

**CF-11 — Critérios de aceite**
- Master é provisionado por procedimento controlado, sem credencial padrão publicada e sem cadastro administrativo aberto.
- Master utiliza 2FA obrigatório e pode consultar usuários, contas, saldos, movimentações e eventos de acesso.
- Consultas têm paginação e filtros por usuário, período, ação, resultado e IP, conforme o recurso.
- Cada consulta administrativa registra quem consultou, quando e qual conta ou conjunto de filtros foi acessado.
- Master não altera saldos, executa operações financeiras por terceiros nem apaga a trilha.

### Interface, qualidade e entrega

| ID | Prioridade | Item | Esforço | Depende de |
|---|---|---|---|---|
| CF-12 | P0 | Interface mínima da carteira | M | CF-02 a CF-08, CF-10 |
| CF-13 | P0 | Interface mínima de auditoria | M | CF-11 |
| CF-14 | P0 | Testes dos fluxos críticos | G | CF-02 a CF-11 |
| CF-15 | P0 | Execução reproduzível, documentação e demonstração | M | CF-01 a CF-14 |
| CF-16 | P1 | Alertas e indicadores operacionais | M | CF-09, CF-15 |
| CF-18 | P1 | Perfil do usuário: dados bancários e Pix, preferências, reconhecimento facial e trilha de acesso com mapas | G | CF-03, CF-04, CF-10 |
| CF-17 | P1 | Melhorias visuais da investigação | M | CF-10, CF-13 |

**CF-12 — Critérios de aceite**
- Reaproveita o template para cadastro, login, ativação/validação de 2FA, recuperação, saldo, extrato, transferência e devolução.
- Exibe validações, andamento, sucesso e erro; valores financeiros vêm do backend.
- Fluxos financeiros não dependem do backend simulado do template.
- Transferência e devolução não exigem novo código após o login completo.
- Exibe indicação clara de "Ambiente de demonstração — valores simulados" nas telas financeiras.

**CF-13 — Critérios de aceite**
- Área administrativa permite localizar uma conta e consultar suas movimentações e acessos.
- Mostra IP, contexto do dispositivo, localização/precisão quando disponível e resultado dos eventos.
- Usuários comuns não acessam os dados administrativos, mesmo por chamada direta à API.

**CF-14 — Critérios de aceite**
- Testes unitários cobrem regras de valor, saldo e permissão para devolver.
- Testes de integração usam banco real de testes e verificam atomicidade, rollback, concorrência e repetição de operações.
- Testes de segurança verificam isolamento entre contas, acesso master, sessão incompleta de 2FA e uso único da recuperação.
- Testes verificam saldo zero, depósito, transferência, devolução, recusa por saldo insuficiente e auditoria correspondente.
- Testes são desenvolvidos junto com os itens; esta história consolida a validação da entrega.

**CF-15 — Critérios de aceite**
- Docker e instruções permitem iniciar os serviços e aplicar migrações a partir de uma instalação limpa.
- README e documentação da API explicam execução, regras, premissas, testes e limitações conhecidas.
- Aplicação oferece verificação básica de saúde e logs estruturados com correlação e sem dados secretos.
- Documenta como provisionar o master, simular um depósito e configurar autenticadores sem publicar credenciais reais.
- Roteiro demonstra duas contas inicialmente zeradas, depósito, transferência, devolução, recusa por saldo e consulta master.
- Documenta armazenamento, acesso e prazo de retenção escolhido para dados de localização e auditoria na demonstração; uso real exige uma política própria.
- README e apresentação distinguem as funções demonstradas da futura integração bancária; não afirmam que a aplicação já movimenta dinheiro real.

**CF-16 — Critérios de aceite**
- Indicadores de disponibilidade, falhas e tentativas de acesso podem ser consultados.
- Alertas operacionais têm limites definidos e não expõem dados sensíveis.

**CF-17 — Critérios de aceite**
- Acrescenta visualização local de posição em grade de latitude/longitude e visualização cronológica de eventos relacionados, sem transmitir localização a mapas externos.
- Mantém indicação de precisão e indisponibilidade, sem atribuir certeza à localização recebida.

## Evolução futura: dinheiro real

Fora da entrega de três dias e sem provedor definido. A arquitetura deverá permitir acrescentar uma integração bancária; essa possibilidade não significa que a solução esteja pronta para operar valores reais.

- Selecionar banco ou provedor de pagamentos e definir serviços, credenciais, contrato e requisitos aplicáveis à operação.
- Integrar primeiro em ambiente de testes do provedor, com confirmação autenticada de pagamentos, proteção contra duplicidade e conciliação entre os registros internos e externos.
- Definir o modelo de contas e guarda dos recursos com o parceiro, incluindo como o saldo interno corresponde ao dinheiro efetivamente disponível.
- Tratar depósitos, transferências internas e eventuais retiradas para bancos como operações distintas; retiradas ainda precisam de escopo próprio.
- Definir estados pendentes, falhas e devoluções externas: uma transação no banco de dados local não desfaz, sozinha, um pagamento já realizado pelo provedor.

Texto proposto para a apresentação:

> Esta versão demonstra a carteira com valores simulados. O projeto pode evoluir para movimentar dinheiro real mediante integração com um banco ou provedor de pagamentos, com confirmação e conciliação das operações. Essa integração não faz parte da entrega atual.

## Sequência proposta para os três dias

| Dia | Foco | Resultado esperado |
|---|---|---|
| 1 | CF-01 a CF-04 e fundação de CF-09 | Cadastro, carteira zerada e acesso com 2FA; estrutura de auditoria pronta. |
| 2 | CF-05 a CF-08, integração de CF-09 e CF-10 | Movimentações e devolução consistentes, contexto de acesso e testes financeiros. |
| 3 | CF-11 a CF-15 | Master, telas mínimas, validação integrada, documentação e ensaio da demonstração. |

Os testes e a documentação acompanham o desenvolvimento desde o primeiro dia. P1 fica fora da meta inicial.

## Capacidade e riscos

O prazo é conhecido, mas a disponibilidade diária e o número de pessoas não foram informados. A sequência acima é uma proposta de execução, não uma garantia de capacidade. O escopo cresceu em relação ao PDF com 2FA, recuperação, geolocalização, master e auditoria detalhada.

- **Prazo apertado:** limitar a interface às telas essenciais e reservar parte do último dia para correções e apresentação. Reavaliar o avanço ao final do primeiro dia; não reduzir silenciosamente requisitos P0.
- **Template existente:** verificar execução e autenticação simulada cedo para evitar que a integração comprometa o backend.
- **Concorrência financeira:** validar com testes de integração antes de investir em acabamento visual.
- **Geolocalização:** prever negativa e indisponibilidade como resultados normais.
- **Segurança administrativa:** restringir provisionamento, proteger segredos e auditar também o auditor.

## Definição de concluído

- Critérios de aceite atendidos e comportamentos recusados demonstráveis.
- Testes relevantes aprovados e instruções de execução verificadas.
- Nenhum segredo incluído no código, documentação ou logs.
- Operações financeiras e acessos administrativos rastreáveis.
- Interface integrada à API real nos fluxos entregues.
- Premissas e limitações documentadas; aplicação pronta para apresentação.
