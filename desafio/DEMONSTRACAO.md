# Roteiro da demonstração ao vivo

Guia prático para **mostrar a aplicação funcionando**, na ordem em que o avaliador costuma perguntar. Dura de 15 a 20 minutos. Para a conversa sobre arquitetura e decisões, use [APRESENTACAO.md](../docs/APRESENTACAO.md); para o passo a passo resumido, [ENTREGA.md](../docs/ENTREGA.md).

## Antes de começar (10 minutos antes)

| Item | Como conferir |
|---|---|
| Sistema no ar | `.\scripts\setup.ps1` e abrir http://localhost:3080. Em outro terminal: `docker compose --env-file .docker.env ps` com tudo `healthy`. |
| Aplicativo autenticador | Google ou Microsoft Authenticator **no celular**, para cadastrar o 2FA das contas ao vivo. |
| Segunda janela | Uma janela anônima do navegador, para o segundo usuário ficar logado ao mesmo tempo (cookies separados). |
| Log da API | Um terminal com `docker compose --env-file .docker.env logs -f api`: o link de recuperação de senha e o código do Pix aparecem ali (e-mail e diretório são simulados). |
| Master | E-mail e senha em `.local/master.json`. Não mostre a tela com a senha. |
| Internet | Os mapas usam o OpenStreetMap. Sem rede, os mapas ficam sem imagem (os marcadores continuam). |
| Câmera | Teste o reconhecimento facial **antes**: foi o único fluxo que nunca foi exercitado com câmera real. Se não houver câmera, mostre só a tela de preparação e explique. |
| Nomes dos usuários | Combine antes: **Ana** (`ana@example.test`) e **Bia** (`bia@example.test`). A senha precisa de 12 caracteres ou mais. |

> Plano B: se algo falhar ao vivo, rode os testes de tela (`cd e2e; npm test`). Eles percorrem o fluxo do cliente em um navegador real e mostram que funciona.

## Roteiro

### 1. Cadastro e autenticação em dois fatores (3 min)
**Requisito:** cadastro e autenticação.

1. Crie a conta da Ana. **Diga:** a carteira nasce com saldo zero, na mesma transação do usuário.
2. Entre com a senha. **Diga:** a senha só abre uma sessão parcial, sem acesso a dinheiro.
3. Escaneie o QR code, digite o código e **guarde os códigos de recuperação** (aparecem uma única vez).
4. Repita na janela anônima para a Bia.
5. Mostre "Esqueci minha senha" na tela de login. **Diga:** link de 7 minutos, uso único; o 2FA continua exigido depois.

**Pergunta provável:** "por que dois fatores?" → senha vazada sozinha nunca chega às rotas com dinheiro.

### 2. Saldo, transferência e validação de saldo (4 min)
**Requisitos:** enviar e receber dinheiro; validar saldo antes de transferir.

1. Ana: **Minha carteira** → "Adicionar saldo" → R$ 100,00. **Diga:** é saldo simulado, entra pelo mesmo caminho de uma transferência (razão, idempotência, auditoria).
2. Ana: transferir **R$ 999,00** para a Bia. Mostre a recusa por **saldo insuficiente**, sem alterar o saldo.
3. Ana: abrir a confirmação e **cancelar**. Nada se move.
4. Ana: transferir **R$ 30,00** para a Bia. Saldo da Ana: R$ 70,00.
5. Bia: o **sino** mostra 1 notificação; abra **Notificações** e marque como lida.

**Diga:** as duas carteiras são bloqueadas antes de ler o saldo, em ordem fixa; há um teste com 25 saídas simultâneas sobre o mesmo saldo.

### 3. Transferência reversível (3 min)
**Requisito:** reversão por inconsistência ou por solicitação do usuário.

1. Bia: no extrato, clique em **Devolver** → devolução integral dos R$ 30,00.
2. Mostre que o botão some (devolução única) e o saldo da Bia volta a zero.
3. Ana: recebe a notificação de devolução; saldo volta a R$ 100,00.

**Diga os dois níveis:**
- **Automático:** tudo é uma transação; qualquer falha desfaz saldos, movimento, lançamentos e auditoria.
- **Pedido do usuário:** a devolução é um **novo movimento** ligado ao original. Nada é apagado nem editado.

Se perguntarem sobre repetição de requisição: a **idempotência** impede pagar duas vezes no clique duplo ou na falha de rede.

### 4. Relatórios (1 min)
**Diferencial:** BI do usuário.

Ana: **Relatórios** (é a página inicial depois do login). Mostre indicadores, gráficos e as sugestões automáticas. **Diga:** são regras sobre o próprio razão do usuário, não aconselhamento financeiro.

### 5. Meu perfil (4 min)
**Dados bancários e Pix:**
1. Ana: **Meu perfil → Dados bancários** → cadastrar uma conta com o CPF `529.982.247-25` (válido). Mostre as máscaras.
2. Cadastrar uma **chave Pix CPF**: aprovada na hora. Tentar a mesma chave de novo: recusada (chave única).
3. Cadastrar uma chave **e-mail**: fica pendente. Pegue o **código no log da API** e confirme. Mostre **editar** e **excluir**.
4. Cadastrar uma **segunda conta** em outro banco. **Diga:** a chave é única no sistema e pertence a uma conta cadastrada; o registro no Banco Central é simulado atrás de uma interface.

**Segurança:** ligar e desligar geolocalização e biometria. **Reconhecimento facial:** abrir a tela de preparação (oval, botão "Começar") e a modal com a prova de vida (direita, esquerda, abaixar, levantar e sorrir). **Diga:** o rosto só soma ao link do e-mail na recuperação de senha; não o substitui.

**Trilha de acesso:** histórico de entradas e saídas, tempo de permanência, **um mapa por acesso** e o **mapa geral**, com tooltip em cada marcador (data no formato dd/mm/aaaa h:mm:ss). Faça logout e login para gerar outro registro.

### 6. Perfil master (auditor) (3 min)
**Requisito:** acompanhamento e auditoria.

1. Saia e entre com o master (também configura o 2FA).
2. **Contas** → escolha a Ana → extrato.
3. **Trilha de auditoria** → filtre por usuário/IP → abra **Atividades**.
4. **Rastrear** a transferência da Ana para a Bia: registro, lançamentos e eventos de ponta a ponta.
5. **Monitoramento:** mostre "Sem divergências" na conciliação.

**Diga:** o master só **lê**; as consultas dele também ficam na auditoria.

## Para fechar (2 min)

- **Testes:** `docker compose --env-file .docker.env --profile test run --rm tests` → 105 testes (unitários e integração contra PostgreSQL real) e o e2e com Playwright.
- **CI:** a pipeline do GitHub roda backend, qualidade, tipos e e2e em cada envio (passou na `main`).
- **Documentação:** README, API, arquitetura (com diagramas), entrega e este roteiro.

## O que dizer sobre os limites (honestidade conta ponto)

- Valores, e-mail, Pix/DICT e depósitos são **simulados**; dinheiro real é uma evolução futura.
- A prova de vida do rosto roda **no navegador**, por isso soma ao e-mail e não o substitui. Em produção seria o SDK biométrico do aplicativo.
- O CPF do titular é único por usuário, mas provar que é mesmo dele exige KYC no cadastro, que a demonstração não tem.
- O master não tem teste automatizado de tela (foi testado manualmente).
- HTTPS, cookie `Secure` e HSTS dependem da publicação com TLS.

## Perguntas difíceis, em uma linha

| Pergunta | Resposta curta |
|---|---|
| Por que centavos inteiros? | Ponto flutuante não representa 0,1 + 0,2 com exatidão. |
| Como evita gasto duplo? | `FOR UPDATE` em ordem fixa e `CHECK (balance >= 0)`. |
| Por que sessão no servidor e não JWT? | Revogação imediata (logout, troca de senha, 5 sessões no máximo). |
| Por que o histórico é imutável? | Gatilhos mais permissões sem UPDATE/DELETE; estorno é novo movimento. |
| Como escalaria? | API sem estado, limites no banco, idempotência; próximos passos: fila de e-mail, cursor no extrato e provedor de pagamento com webhook. |
