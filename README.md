# Carteira financeira — execução no Docker

A aplicação operacional está em `frontend/` (Next.js) e `backend/` (NestJS), com TypeScript e PostgreSQL. As fontes são locais, sem dependência de CDN.

**Somente valores simulados.** Integração com dinheiro real é uma evolução futura, não implementada.

## Iniciar

Com Docker Desktop aberto, execute no PowerShell a partir deste diretório:

```powershell
.\scripts\setup.ps1
```

Abra **http://localhost:3080**. O projeto no Docker Desktop chama-se `carteira_financeira`.

- Crie uma conta pela interface. Ela começa com saldo zero.
- Faça login e cadastre um aplicativo autenticador pelo QR Code. Guarde os códigos de recuperação.
- O master usa o e-mail e a senha aleatória de `.local/master.json`. Seu primeiro login também exige configurar o autenticador. Não compartilhe esse arquivo.
- `.docker.env` contém segredos locais gerados pelo instalador. Não publique esse arquivo nem o conteúdo de `.local/`. Ambos são ignorados pelo Git e não vêm ao clonar o repositório: `scripts/setup.ps1` os cria na primeira execução.

## Acessar PostgreSQL pelo DBeaver

Host `127.0.0.1`, porta `5433`, banco `carteira`, usuário `postgres`. A senha é o valor de `POSTGRES_PASSWORD` em `.docker.env`. A porta é publicada somente neste computador. A conexão local de demonstração não exige SSL.

## Adicionar saldo de demonstração

**Pela tela (saldo inicial):** na aba "Minha carteira", use "Adicionar saldo", informe o valor em reais e confirme. O valor é simulado, vai somente para a sua própria carteira e é limitado a R$ 10.000,00 por adição e 20 adições por hora. Cada clique repetido por falha de rede não credita duas vezes. Esse recurso só funciona com `DEMO_DEPOSITS=true` (já configurado no `compose.yaml` de demonstração); sem a variável, a API responde "Depósitos simulados desabilitados.". O master não tem carteira e não pode adicionar saldo.

**Pelo operador local** (qualquer carteira, sem o teto acima):

```powershell
docker compose --env-file .docker.env exec api node dist/operator.js deposit usuario@example.com 10000 deposito-demo-001
```

`10000` significa R$ 100,00. Repita a mesma referência apenas para repetir a mesma operação; ela não será creditada duas vezes. Uma nova entrada exige outra referência.

Nos dois casos o crédito passa pelo mesmo caminho (provedor, razão, idempotência e auditoria) e aparece no extrato como "Depósito simulado". Em produção, com um banco real, quem confirma o pagamento é o provedor e a adição pelo próprio usuário deixaria de existir.

## Recuperar a senha

Na tela de login, use "Esqueci minha senha". O link tem validade de 7 minutos e serve uma única vez. Como o envio de e-mail é simulado, na demonstração o link aparece no log da API:

```powershell
docker compose --env-file .docker.env logs --tail 20 api
```

Procure a linha `mail.simulated` e abra o `link` no navegador. Após redefinir, todas as sessões são encerradas e o código do autenticador continua obrigatório.

## Verificar e operar

```powershell
docker compose --env-file .docker.env ps
docker compose --env-file .docker.env --profile test run --rm tests
docker compose --env-file .docker.env logs --tail 50 api
docker compose --env-file .docker.env stop
docker compose --env-file .docker.env up -d
```

Os testes usam banco separado `carteira_test`; os dados da demonstração ficam em volume persistente. Não use `down -v` para interromper a aplicação, pois isso apaga seu volume.

## Documentação da entrega

- [Contrato da API e exemplos](docs/API.md)
- [Arquitetura, segurança e limitações](docs/ARQUITETURA.md)
- [Banco de dados: tabelas, relacionamentos e diagramas](docs/BANCO_DE_DADOS.md)
- [Roteiro de demonstração e validação](docs/ENTREGA.md)
- [Backlog](BACKLOG.md)
