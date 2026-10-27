# Arquitetura e decisões

```text
Navegador → localhost:3080 / Nginx
                         ├── /       → Next.js (frontend)
                         └── /api/*  → NestJS → PostgreSQL
Operador local → comando controlado de depósito / provisionamento master
```

Gateway e PostgreSQL publicam portas limitadas a 127.0.0.1: 3080 para a aplicação e 5433 para acesso local pelo DBeaver. API e frontend usam apenas rede Docker privada. O gateway sobrescreve o cabeçalho de IP encaminhado, e a API confia em um único proxy. Em Docker Desktop, NAT pode fazer o IP observado corresponder ao intermediário local; ele não deve ser apresentado como identificação inequívoca de um telefone.

## Separação de responsabilidades

- `auth.ts`: cadastro, senha, sessões, TOTP, recuperação e limitação de tentativas.
- `wallet.ts`: regras financeiras, idempotência e contrato de integração para depósitos.
- `audit.ts`: registro central de eventos.
- `admin.ts`: consultas administrativas, rastreio e indicadores.
- `db.ts`: unidade de trabalho transacional; `migrations/`: esquema versionado.
- `main.ts`: controladores, autenticação/autorização e tratamento de erros.
- `operator.ts`: operações locais restritas, sem endpoint público equivalente.

Injeção de dependências mantém os serviços separados. SQL parametrizado torna os bloqueios e limites transacionais explícitos. Um backend único reduz a complexidade operacional do desafio. O provedor simulado de depósito implementa uma interface; um provedor real exigirá implementação, contrato e validações adicionais.

## Consistência financeira

Centavos inteiros, restrições no banco, carteira sem saldo negativo e limite de R$ 10 bilhões por carteira/operação. Os limites são de demonstração, não de política bancária real.

Transferência bloqueia as carteiras em ordem de UUID, debita, credita, insere movimentação, lançamentos, chave de idempotência e auditoria na mesma transação. Qualquer falha desfaz tudo. Falhas e recusas são auditadas separadamente após o rollback.

Requisições repetidas são serializadas por chave de idempotência e escopo. Devoluções são também serializadas pelo ID da transferência original, sem exigir permissão de alteração do histórico. Uma restrição única impede duas devoluções da mesma transferência. Não se apagam nem se editam registros financeiros para representar estorno.

## Autenticação e autorização

- Senhas derivadas com scrypt e salt individual.
- TOTP de 6 dígitos, período de 30 segundos, tolerância de um período e bloqueio de reutilização do contador aceito.
- Segredo TOTP cifrado com AES-256-GCM; chave externa ao código.
- Oito códigos de recuperação de uso único, guardados como hashes e exibidos somente na ativação.
- Sessões opacas aleatórias; apenas hashes ficam no banco. Etapa parcial expira em 10 minutos; completa em 8 horas.
- Cookies HttpOnly e SameSite=Strict; POST exige origem permitida e cabeçalho específico.
- Limites persistidos no PostgreSQL: login por conta/IP, segundo fator, cadastro e operações autenticadas.
- Cadastro não recebe perfil; master nasce exclusivamente no provisionamento local e também exige 2FA.
- Recuperação de senha: token aleatório de 256 bits, válido por 7 minutos, de uso único (`DELETE ... RETURNING`); só o hash fica no banco e um novo pedido invalida o anterior. A resposta ao pedido é igual para contas existentes ou não, com limite por IP e por e-mail. O token viaja no fragmento da URL (não vai ao servidor nem a logs de acesso) e é removido da barra de endereço ao ser lido. Redefinir a senha encerra todas as sessões e não desativa o 2FA. O envio é simulado (`DEMO_MAIL=true` escreve o link no log da API); um provedor real implementaria `MailProvider`.
- Troca do autenticador exige senha e segundo fator/recuperação, revoga todas as sessões e bloqueia operações até a nova ativação.

## Auditoria e localização

Eventos contêm autor quando identificado, recurso, data do servidor, resultado, motivo, correlação, IP, navegador e localização quando disponível. Tentativas de login com conta conhecida são associadas ao recurso da conta, mesmo sem autor autenticado. Consultas do master também são registradas.

A credencial do serviço não tem UPDATE/DELETE em auditoria, movimentações ou lançamentos. Gatilhos também recusam mutações do histórico. Isso protege contra alterações pela aplicação, mas não constitui armazenamento inviolável contra um administrador do banco com poder de alterar o esquema.

Senha, token, códigos TOTP, chaves de recuperação e segredo do autenticador não entram nos logs. Localização é contextual, validada quanto ao formato e não verificada quanto à veracidade. A visualização usa grade geográfica local, sem enviar coordenadas a serviços externos.

Política desta demonstração: usar dados fictícios; manter dados somente durante o período de avaliação, com prazo operacional máximo proposto de 30 dias. A remoção ao encerrar a demonstração exige procedimento explícito do responsável sobre o volume, pois a aplicação não permite apagar a trilha. Não há expurgo automático implementado. Produção exige política própria de retenção, controles de acesso, backup, gestão de chaves e operação.

## Limitações deliberadas

- Não movimenta dinheiro real, não integra bancos e não oferece saques.
- HTTP e cookie sem Secure somente no localhost; publicação externa exige HTTPS, cookie Secure e origens/rede configuradas. A geolocalização em celular exige contexto seguro e acesso de rede próprio, não disponível nesta configuração local.
- Monitoramento é um painel consultado sob demanda, com healthchecks e logs. Alertas visuais surgem a partir de 5 recusas/falhas em 15 minutos ou divergência de conciliação; não há envio de notificações.
- A grade local mostra latitude/longitude e precisão, sem mapa de ruas, geocodificação ou identificação física do dispositivo.
- A senha pode ser redefinida por link de 7 minutos, mas o e-mail é simulado (o link aparece no log da API com `DEMO_MAIL=true`; não deve ficar ativo fora da demonstração). A perda do autenticador depende de um código de reserva; não há desativação de 2FA nem recuperação por SMS.
- As credenciais iniciais ficam nos arquivos locais ignorados pelo Git; o responsável deve protegê-los e controlar o acesso ao Docker.

## Evolução para dinheiro real

Integrar com banco/provedor habilitado, definir modelo de contas e recursos, confirmar pagamentos por notificações autenticadas, conciliar saldos externos e internos e tratar operações pendentes. A transação local não reverte automaticamente uma operação externa já liquidada. Essa evolução não está implementada.
