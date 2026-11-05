# Protocolo editorial obrigatório — Channel Intelligence antes de cada vídeo

**Escopo:** canais gerenciados no Caçadores de Nichos, incluindo o Conectividade Universal (YouTube `UCRBCnTUJ_ow5dXxENuNkdHA`).

## Regra de produção
Antes de aprovar um novo tema, gerar roteiro, planejar cenas ou produzir MP4, criar um **Channel Intelligence Brief** atualizado, datado, com evidências e limitações, e anexá-lo ao registro editorial do episódio. O planejamento deve indicar quais dados sustentam cada hipótese; uma conclusão sem evidência não é aprendizado.

**Fontes obrigatórias quando disponíveis:**
1. Panorama do canal: métricas 7/28 dias, alcance, visualizações engajadas, inscritos, fontes de tráfego, interesse temático.
2. Últimos 3 a 5 vídeos: títulos, thumbnails, impressões, CTR por tráfego, evolução em 24h/72h/7d, retenção inicial, duração média e segmentos em que a audiência abandonou.
3. **Comentários**: perguntas recorrentes, objeções, pedidos explícitos, críticas técnicas, problemas de compreensão e novas pautas. Registrar total de comentários analisados, URLs/IDs dos vídeos e período. Comentários individuais nunca equivalem a tendência estatística.
4. Contexto de pesquisa: informações verificadas, limitações de tecnologia, fontes primárias e temas não resolvidos no vídeo anterior.
5. Evidência comparativa: temas de concorrentes ou pesquisas de tendência **separados** da reação da própria audiência.

## Saída do brief
- 3 a 5 opções de tema, cada uma com intenção de busca, pergunta central, evidência, hipótese concorrente, diferencial editorial, risco de factualidade, confiança e ganchos de retenção.
- Uma proposta fundamentada de título/thumb que complemente o conteúdo; **não inferir CTR de imagem gerada**.
- Ajustes narrativos verificáveis: abertura, primeira recompensa, loops e objeções não resolvidas.
- Lista de dados ausentes, limite da amostra e quais medições colher após publicar.
- Plano de avaliação em 24h/72h/7d e o que comparar no próximo episódio.

## Regras de análise / experimentação
- Não classificar uma CTR como ruim usando limiar universal: considerar impressões, tráfego, audiência e histórico do canal.
- Distinguir CTR de retenção. Achar que a thumb causou abandono é hipótese, não evidência.
- Preferir **teste A/B nativo simultâneo do YouTube** ao alternar thumbnails/títulos, quando disponível. Sequências antes/depois podem sofrer influência de tráfego, horário e sazonalidade; registrar como observacionais.
- Registrar data, vídeo, versão de thumb/título, hipótese, evidência antes/depois, decisão e limitações.
- Aprendizados comprovados são versionados no Channel Brain do canal e consultados no Next Episode. Experimentações sem resultado permanecem hipóteses; não herdar como regra factual.
- Não alterar vídeos/publicar automaticamente: aprovação específica do proprietário para qualquer mudança.

## Conectividade Universal — linha de base 02/11/2026
Fontes: vidIQ conectado ao ChatGPT; visualização do usuário no YouTube Studio. Vídeo publicado `IQTbwGiTQpA`, 30m45s, publicado 31/10/2026. Outra publicação `VYLZFZC0GqI` estava privada/agendada, sem audiência analisável.
- Captura do YouTube Studio: CTR 7,8% sobre 21,3 mil impressões (janela da captura não confirmada por API; não misturar com séries do vidIQ).
- Retenção pela Analytics API, período 31/10 a 01/11: 94,23% em 1% do vídeo, 73,09% em 2%, 62,29% em 3%, 43,52% em 4% (~1:14) e 35,91% em 10%. Diagnóstico: auditar narração e cenas na primeira janela de 75s; a causa ainda não é comprovada.
- Três comentários acessíveis: um questiona a substituição das operadoras móveis, um aborda crítica sobre personagem político, e um é apoio expresso em emojis. **Amostra insuficiente para afirmar preferência do público**. Objeção útil para investigação: complementaridade e limites da conexão direta por satélite versus redes tradicionais.
- Não é recomendável trocar automaticamente thumbnail/título com base apenas nesses dados.

## Integrações e estado de fato
- O ChatGPT já tem acesso autorizado ao canal, às estatísticas de vídeos e aos comentários via plugin vidIQ; consultar diretamente antes de cada nova produção solicitada nesta conversa.
- O Caçadores possui Performance Analyst, Channel Brain, Closed Loop e Next Episode; no momento o OAuth do canal Conectividade Universal ainda precisa ser vinculado no próprio Caçadores para que a coleta seja nativa/automática ali.
- A aplicação de uma exigência técnica de bloqueio automático antes da escrita do roteiro ainda não está ligada ao fluxo UI. Este documento descreve o protocolo obrigatório, não uma automação já implantada.

**Check de entrega:** nenhum novo vídeo deve ser descrito como “baseado em dados do canal” sem um brief recente, identificando as fontes, vídeos e comentários consultados.
