# Diretrizes de Roteamento de Modelos e Delegação

A sessão principal decide, integra e confere. Trabalho volumoso e mecânico vai para modelos mais baratos. O que volta é rascunho a conferir, não resposta final.

## Regras antes de delegar
1. **Poucas ações?** Faça direto (delegação tem custo fixo).
2. **Precisa do contexto atual?** Mantenha na sessão principal.
3. **Dinheiro, dados, produção ou segurança?** Use Opus e confira com rigor.
4. **Gabarito objetivo (testes/números)?** Use Sonnet e exija evidências.
5. **Volume mecânico (ler, buscar, resumir, converter)?** Use Haiku.
6. **Na dúvida:** Use Sonnet.

## Como delegar
- **Especifique o modelo:** Informe explicitamente o modelo ao criar o agente (haiku, sonnet ou opus). O agente Explore herda o modelo da sessão se não for especificado.
- **Prompt autocontido:** Informe caminhos, formato esperado e a regra: *"Se não encontrar, informe que não encontrou; não deduza."*
- **Exija evidências:** Solicite comprovação ou testes junto de cada afirmação.

## Conferência e Escalabilidade
- **Revise o retorno:** Sempre confira o código/resposta entregue pelo agente antes de integrar.
- **Retorno incompleto?** Suba um degrau (Haiku -> Sonnet -> Opus). Não pule direto para o topo.
- **Lotes grandes:** Agentes baratos (Haiku) processam o volume, Opus revisa, a sessão principal consolida.

## Prestação de Contas
- Ao finalizar a tarefa, informe em uma linha quais modelos foram utilizados e para qual finalidade.
