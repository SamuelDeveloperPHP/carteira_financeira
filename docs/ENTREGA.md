# Entrega e demonstração

## Roteiro

1. Execute `scripts/setup.ps1` e abra http://localhost:3080.
2. Cadastre duas contas fictícias e confirme o saldo inicial zero. Configure o autenticador e guarde a recuperação em cada uma.
3. Na primeira conta, use "Adicionar saldo" para inserir R$ 100,00 (saldo inicial simulado). O comando local do operador, descrito no README, continua disponível.
4. Na primeira conta, transfira R$ 30,00 para o e-mail da segunda; confira R$ 70,00 e R$ 30,00 nos extratos.
   Na segunda conta, observe o sino com o contador e a página "Notificações" com o aviso da transferência; marque como lida e veja que ele some.
5. Na segunda, devolva os R$ 30,00 e confira o vínculo com a transferência original. A primeira conta recebe uma notificação de devolução.
6. Demonstre uma tentativa com saldo insuficiente, sem alteração dos saldos.
7. Entre com o master usando `.local/master.json` e configure seu próprio 2FA. Consulte contas, extratos, eventos, IP e localização disponível.
8. Filtre os acessos e rastreie uma movimentação. A própria consulta do master deixa registro.
9. Mostre monitoramento/conciliação e explique os testes de concorrência, rollback e repetição de requisições.
10. Em "Meu perfil": cadastre uma conta (CPF válido do titular) e registre chaves Pix (CPF é aprovado na hora; e-mail pede o código, que aparece no log da API). Tente repetir uma chave e veja a recusa. Na aba "Segurança" ligue/desligue biometria e geolocalização e ative o reconhecimento facial (a câmera pede a prova de vida). Na aba "Trilha de acesso" confira o histórico (entrada, saída, permanência), o mapa de cada acesso e o mapa geral, com tooltip em cada marcador.
11. Ressalte que os valores são simulados e que a integração bancária é uma evolução futura.

## Verificação automatizada

```powershell
docker compose --env-file .docker.env --profile test run --rm tests
```

**Testes de tela (ponta a ponta).** Com o sistema no ar (`scripts/setup.ps1`), o Playwright percorre o fluxo do cliente em um navegador real, com duas contas novas: cadastro, 2FA (o código sai do segredo exibido na tela), adicionar saldo, saldo insuficiente, cancelar a confirmação, transferência, sino e notificação, devolução, aviso da devolução, painel de BI, trilha de acesso com localização, F5, logout e rotas protegidas.

```powershell
cd e2e
npm ci
npx playwright install chromium
npm test
```

**Integração contínua.** `.github/workflows/ci.yml` roda a cada envio e a cada pull request: (1) os testes do backend no Docker, (2) verificação de tipos do backend e do frontend e auditoria de dependências (informativa) e (3) o sistema completo no Docker com os testes de tela. Segredos são gerados na hora em cada execução; em caso de falha, o relatório do Playwright e os logs dos containers ficam anexados. A pipeline ainda não foi executada no GitHub; os mesmos comandos foram executados localmente.

Banco de testes separado, com armazenamento temporário. O teste recusa uma URL cujo banco não termine em `_test`. As credenciais da aplicação de teste também têm permissões restritas; a conexão de proprietário é usada apenas para preparar cenários e injetar falhas controladas nesse banco.

Suíte validada em 28/10/2026: **101 testes aprovados**: 5 unitários de segurança, 75 unitários de regras (transferência, devolução, notificações, depósito do operador e do usuário, contas bancárias e chaves Pix, rosto cifrado e comparado, queda do provedor, rollback simulado, falha do próprio rollback, DTOs, guard e recuperação de senha, com repositórios em memória) e a suíte de integração contra PostgreSQL com seus cenários. Abrange recuperação de senha (link de 7 minutos, uso único), 25 saídas simultâneas sobre o mesmo saldo, limite de 5 sessões por usuário, orçamento de auditoria para ruído anônimo, saldo zero, 2FA obrigatório, recuperação de uso único, depósito controlado/idempotente, autorização, concorrência financeira, devolução integral, saldo insuficiente, rollback provocado no crédito, restrições do histórico, consultas master, localização, limitação de tentativas, rotação do autenticador e logout. Os erros 500 registrados durante o cenário de falha provocada são esperados pelo teste.

As imagens Docker compilam backend e frontend com TypeScript. A instalação das dependências das imagens informou zero vulnerabilidades conhecidas no momento da verificação; isso não substitui uma auditoria de segurança de produção.

## Situação do backlog

| Itens | Entrega |
|---|---|
| CF-01 a CF-04 | Banco, cadastro, autorização, sessões e 2FA com recuperação |
| CF-05 a CF-08 | Depósito restrito, transferências, devoluções, saldo e extrato |
| CF-09 a CF-11 | Auditoria, localização e master de leitura |
| CF-12 e CF-13 | Interface operacional da carteira e área administrativa |
| CF-14 e CF-15 | Testes, Docker, documentação e roteiro |
| CF-16 | Indicadores, conciliação e alertas visuais sob demanda |
| CF-17 | Linha do tempo e posição em grade geográfica local no painel do master |
| CF-19 | Painel de BI do usuário: indicadores, gráficos em SVG e sugestões automáticas, em página própria |
| CF-18 | Perfil: contas e chaves Pix (aprovação simulada), preferências, reconhecimento facial na recuperação de senha, trilha de acesso com mapas Leaflet |

O template original foi preservado. A aplicação entregue usa `frontend/`, reaproveitando Bootstrap e fontes locais, e `backend/`. Não há dependência de PHP/Apache/WAMP para executar os containers.
