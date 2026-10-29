export default function AboutPage() {
  return (
    <section className="panel">
      <h2>Uma carteira para demonstrar o fluxo completo</h2>
      <p>
        Os saldos são simulados. Cada conta começa com zero, recebe saldo
        adicionado pelo próprio usuário ou transferências de outras contas e
        pode enviar valores a usuários cadastrados.
      </p>
      <h3>Devolução com saldo disponível</h3>
      <p>
        Quem recebeu uma transferência pode devolver seu valor integral uma
        única vez. A operação exige saldo suficiente e preserva o histórico
        original.
      </p>
      <h3>Evolução para dinheiro real</h3>
      <p>
        O projeto pode evoluir mediante integração com um banco ou provedor de
        pagamentos, com confirmação e conciliação das operações. Essa integração
        ainda não está implementada. Não informe credenciais bancárias nesta
        demonstração.
      </p>
      <h3>Auditoria de segurança</h3>
      <p>
        Registramos operações, acessos e consultas relevantes, com IP, contexto
        do navegador e localização quando autorizada. O master pode investigar
        esses registros, mas não pode movimentar seu dinheiro ou apagar a
        trilha.
      </p>
    </section>
  );
}
