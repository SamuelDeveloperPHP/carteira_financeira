# Entrega e demonstração

## Roteiro

1. Execute `scripts/setup.ps1` e abra http://localhost:3080.
2. Cadastre duas contas fictícias e confirme o saldo inicial zero. Configure o autenticador e guarde a recuperação em cada uma.
3. Pelo comando local de operador descrito no README, credite R$ 100,00 na primeira conta.
4. Na primeira conta, transfira R$ 30,00 para o e-mail da segunda; confira R$ 70,00 e R$ 30,00 nos extratos.
5. Na segunda, devolva os R$ 30,00 e confira o vínculo com a transferência original.
6. Demonstre uma tentativa com saldo insuficiente, sem alteração dos saldos.
7. Entre com o master usando `.local/master.json` e configure seu próprio 2FA. Consulte contas, extratos, eventos, IP e localização disponível.
8. Filtre os acessos e rastreie uma movimentação. A própria consulta do master deixa registro.
9. Mostre monitoramento/conciliação e explique os testes de concorrência, rollback e repetição de requisições.
10. Ressalte que os valores são simulados e que a integração bancária é uma evolução futura.

## Verificação automatizada

```powershell
docker compose --env-file .docker.env --profile test run --rm tests
```

Banco de testes separado, com armazenamento temporário. O teste recusa uma URL cujo banco não termine em `_test`. As credenciais da aplicação de teste também têm permissões restritas; a conexão de proprietário é usada apenas para preparar cenários e injetar falhas controladas nesse banco.

Suíte validada em 27/10/2026: **23 testes aprovados**, incluindo o teste principal e seus cenários. Abrange recuperação de senha (link de 7 minutos, uso único), 25 saídas simultâneas sobre o mesmo saldo, limite de 5 sessões por usuário, orçamento de auditoria para ruído anônimo, saldo zero, 2FA obrigatório, recuperação de uso único, depósito controlado/idempotente, autorização, concorrência financeira, devolução integral, saldo insuficiente, rollback provocado no crédito, restrições do histórico, consultas master, localização, limitação de tentativas, rotação do autenticador e logout. Os erros 500 registrados durante o cenário de falha provocada são esperados pelo teste.

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
| CF-17 | Linha do tempo e posição em grade geográfica local; sem mapa externo de ruas |

O template original foi preservado. A aplicação entregue usa `frontend/`, reaproveitando Bootstrap e fontes locais, e `backend/`. Não há dependência de PHP/Apache/WAMP para executar os containers.
