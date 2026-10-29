# Direção da interface

Aplicação financeira para usuários da carteira e para o auditor master. Usa Bootstrap e a família HK Grotesk, ambos locais (sem CDN). O frontend fica em `frontend/`; o template visual de partida foi removido do repositório por não ser usado.

- Paleta: azul institucional #243746, azul escuro #162a38, verde de confirmação #176b57, fundo #f3f6f8, texto #243746 e borda #d8e1e7.
- Tipografia: HK Grotesk local, regular e semibold; valores com números tabulares.
- Login: painel institucional à esquerda e formulário à direita. Em celular, título compacto acima do formulário.
- Conta: navegação lateral, identificação clara do ambiente simulado, saldo e transferência lado a lado; extrato ocupa a largura disponível.
- Auditoria: busca e filtros acima de tabelas, detalhes expandidos por ação, sem depender somente de cores.
- Revisão do plano: priorizar leitura de valores e rastreabilidade em vez de gráficos decorativos; sem fontes remotas, gradientes ou efeitos de entrada.

Estados de carregamento, erro e extrato vazio orientam o próximo passo. Confirmação explícita antes de transferir/devolver. Foco visível, rótulos em todos os campos e tabelas adaptadas por rolagem no celular.
