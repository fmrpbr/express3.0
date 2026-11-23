# Express Entregas V3.0 · candidata local RC1

Data: 22/11/2026
Branch: `codex/express-v3-homologacao-2026-11-22`
Base funcional: concluída a partir da etapa 6A; versão candidata local `3.0.0`.
Checkpoint do código e dos testes: `3fee41b` (`feat: complete local Express V3 workflows`).

## Limite da candidata

Esta é uma candidata de **código e web build local**, preparada depois da suíte completa. Não foi publicada no Firebase, não foi enviada a um projeto hospedado e não substitui o APK. O APK público continua em 2.0.16, com o hash de baseline registrado em [BASELINE-E-ROLLBACK.md](BASELINE-E-ROLLBACK.md). O código Android e o arquivo público do APK não foram alterados. O ambiente não tem Android SDK/Gradle configurados, então não foi produzido um novo APK de homologação.

O `release.json` local e os metadados do pacote agora identificam a candidata como 3.0.0. Esse rótulo vale para esta branch e não representa publicação. O próximo passo externo é a homologação geral com contas e aparelhos reais, após confirmar acesso e isolamento do projeto Firebase de testes.

## Inventário final

| Área | Estado na candidata | Limite restante |
|---|---|---|
| Cadastro e perfis de lojista, motoboy e administrador; aprovação; solicitação, cotação, aceite, confirmação de retirada, conclusão, cancelamento e retorno à fila | Concluído localmente e coberto por testes browser/backend | As contas dos testes são sintéticas e locais. Ainda falta a homologação geral por pessoas no ambiente hospedado de testes. |
| Aceite concorrente e disponibilidade | Concluído no backend e em emulador: uma única transação escolhe o vencedor; disponibilidade separa conexão online, pausa, ocupação e sessão | Reconexão, segundo plano, reinício, som e recebimento remoto precisam de aparelhos e FCM reais. |
| Distribuição de ofertas | Concluída: até 3 convites, 30 segundos e 3 rodadas por padrão; parâmetros ajustáveis pelo admin; resposta pendente obrigatória; recusa opcional, sem punição | Os parâmetros foram testados em emulador; ainda falta calibragem operacional com a equipe. |
| Tempos operacionais | Concluídos: espera desde criação, duração em execução e duração total, calculados pelo relógio do servidor | A conferência em operação real faz parte da rodada final. |
| Clientes e endereço | Concluídos: perfil próprio, endereço por telefone/loja, confirmação e proteção de revisão; links de pré-cadastro selecionam o perfil | Nenhuma pendência de código identificada. |
| Cidades e tarifas | Concluídos localmente: cadastro e pausa de cidade, fuso, tarifa-base/noturna e bairros, cidade persistida no pedido, validação e filtro de relatório | Configurar valores reais e validar abrangência/endereço de cada cidade depende do operador. Rotas continuam limitadas a uma cidade por rota. |
| Rotas e rastreio | Concluídos localmente: várias entregas, rotas entre lojas por adesão, coletas separadas, dados privados por loja, tarifa por entrega e link de navegação com paradas | Ordem das paradas é manual; não há otimização por trânsito/ETA nem rastreio público da sequência completa de várias lojas. Rotas exigem mesma cidade/data. |
| Comprovante digital | Concluído: nome do recebedor, assinatura em canvas e observação, com acesso restrito aos participantes e admin | A candidata não coleta foto/documento de identidade, que não foi exigido no roteiro. Validar uso e retenção na homologação. |
| Pagamentos | Concluído para acerto direto: Pix, pendente → informado pela loja → confirmado pelo motoboy, pendências por dia, relatórios e CSV administrativo | O app não cobra nem movimenta dinheiro. Liquidação pela plataforma depende de decisão comercial e provedor autorizado. |
| Ocorrências e avaliações | Concluídos: registro durante/após operação, resolução administrativa com trilha e notificação; uma avaliação por participante após entrega, resumo agregado | Verificar política de moderação, retenção e respostas operacionais antes de abrir a função ao público. |
| WhatsApp e notificações | Concluídos no cliente: prévia editável, usuário inicia explicitamente o envio; Dispatcher FCM/Web Push, preferências, som local, jobs e lembretes já têm cobertura automatizada | Envio WhatsApp é manual pelo usuário. Entrega remota real, canais de áudio e notificações com app em segundo plano dependem de credenciais e aparelhos. |
| iFood, Aiboo e pede.ai | Estrutura de catálogo, estados de prontidão, opção por loja pausada por padrão e chave idempotente/ledger preparados | **Nenhum adapter/webhook está implementado ou ativo.** O código bloqueia ativação enquanto falta adapter/conexão real. A alegação anterior de iFood integrado não foi comprovada neste repositório nem ambiente. |
| Interface e tutorial | Concluídos localmente: identidade vermelha compartilhada, telas de cidade/integrações, painel/relatórios e tutorial inicial por perfil, que pode ser reaberto | Revisar aparência e acessibilidade com usuários reais na etapa final. |
| Agendamentos | Regras atuais de tarifa/chuva e lembretes foram preservadas; suíte existente passou | Não foi encontrado registro separado do agendamento de 22/11. Não há evidência de uma alteração específica a reconciliar com esse relato. |

## Suítes e builds

- Backend: `node --test tests/backend/*.test.cjs` — **104 passaram, 0 falharam**.
- Regras e integração do Realtime Database Emulator: `npm test --prefix tests/firebase-rules` — **61 passaram, 0 falharam**. Inclui disputa concorrente pelo aceite, regras de privacidade, projeções, rotas, comprovantes, ocorrências, avaliações e estados/configuração de ofertas.
- Browser com Auth e RTDB Emulator: `npm run test:browser` — **24 passaram, 0 falharam**. Cadastro e operação dos três perfis, ofertas, pagamentos, comprovante, ocorrência, avaliação, rotas, relatórios, rastreio, notificações e telas móveis.
- Verificadores: `node scripts/check.mjs` e `npm run lint --prefix functions` — passaram.
- Build web candidato: `npm run build:web` — passou; bundles web e página de rastreio gerados sem dados privados ou segredos.
- `git diff --check` — passou.

Os testes exercitam contas e dados sintéticos em emuladores locais. Eles não comprovam isolamento do Auth/RTDB hospedado, entrega FCM real nem comportamento em aparelho físico.

## Dependências para a homologação geral

1. Acesso ao Console e confirmação documentada do projeto/URL do Firebase de testes; conferir Auth, RTDB e FCM separados de produção, guardar snapshot e testar restauração apenas no Emulator Suite.
2. Contas reais de homologação — lojista, motoboy e administrador — e um ou mais aparelhos Android para alternar online, disponível, ocupado e offline; testar reconexão, segundo plano, reinício, FCM e som.
3. Para iFood/Aiboo/pede.ai: contratos, documentação, credenciais oficiais, autorização do parceiro e sandbox/webhooks. O adapter correspondente deverá ser implementado e validado antes de habilitar chamada automática por loja. Para iFood, primeiro obter evidência do alegado conector existente fora deste checkout.
4. Se houver pagamento pela plataforma: escolher provedor, fluxo de liquidação/reembolso e responsabilidades antes de adicionar movimentação financeira.
5. Depois da aprovação da rodada geral, registrar o resultado por perfil e só então avaliar deploy. Publicação no Firebase de produção, ativação de integrações reais e substituição do APK continuam dependentes da aprovação explícita do usuário.

## Recuperação

O trabalho fica restrito à branch acima. Os commits locais são os checkpoints; reverta o commit funcional com `git revert <commit>` se necessário. O retorno do Firebase Hosting usa o procedimento de [BASELINE-E-ROLLBACK.md](BASELINE-E-ROLLBACK.md); o RTDB requer snapshot/restore separado. Nenhum comando de deploy foi executado e nenhum artefato público foi substituído.
