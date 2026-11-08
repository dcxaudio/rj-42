# Manual do RJ-42 (b0.1)

O RJ-42 é um looper de rack: tira loops de uma música no BPM que você quer. Ele roda sozinho nesta página ou no rack do DCX Studio, embaixo do RJ-950.

## Sozinho nesta página

- Aperte **LIGAR** (ou Espaço).
- Os botões **To RJ-2000** e **To RJ-950** ficam apagados, porque só existem no Studio. O **Disk** salva o loop em WAV ou MP3.
- **MIDI Learn:** o botão no alto da página. Toque num controle do 42, mexa no controlador e aperte Enter (ou Save). Delete apaga o do controle escolhido, Esc sai.
- O que fica salvo neste navegador: as memórias e os ajustes (chaves `rj42/...`).

Um aparelho que não existiu na época: tira loops de 1, 2, 4 ou 8 compassos de uma música, já no BPM que você quer, e manda para o SP, para o 950 ou para um arquivo. O visual é de rack dos anos 80, com LED vermelho de 7 segmentos (como o Lexicon PCM42). As ideias vêm do Lexicon JamMan (tocar no tempo forte para marcar o loop), do Boss SP-202 (cortar no BPM) e do Electrix Repeater (cada loop com o seu tempo). Liga junto com a máquina; o Power desliga e liga.

## Passo a passo

1. **Solte a música no disquete** (ou clique nele). Vale WAV, MP3, AIFF, OGG, FLAC... O RJ-42 acha sozinho o tempo da música e cada batida dela, e põe o início do loop na primeira batida depois do primeiro som. Uma música de 5 minutos leva uns 2 segundos.
2. **Confira o tempo.** O **Source BPM** mostra o tempo da música no trecho do loop, medido nas batidas daquele trecho: disco tocado ao vivo acelera e freia, e o loop precisa fechar no tempo de onde ele está, não na média da música. Por isso o número muda um pouco quando o início anda. Se estiver errado (o dobro, a metade ou outro tempo), toque **Tap Tempo** junto com a música: com 4 toques ou mais, o RJ-42 trava no tempo exato perto do que você tocou e refaz as batidas. Arrastar ou rolar sobre o display do Source BPM fixa o tempo na mão, de 0,1 em 0,1 (sem seguir as batidas), até o próximo Tap.
3. **Escolha o tamanho:** **1, 2, 4 ou 8** compassos (de 4 tempos). O fim do loop é calculado pelo BPM, então ele fecha certinho.
4. **Ache o começo.** Aperte **Set In**: a música toca a partir do início atual (a luz do Play pisca). Aperte **Set In** de novo bem no tempo forte que você quer: o início vai para ali (puxado para o ataque mais perto) e o loop passa a repetir. Também dá para:
   - girar o **Search** (jog): anda o início aos poucos, e acelera quando gira rápido. Parado, toca um pedacinho a cada passo, como o cue de um CD;
   - **Fine** (embaixo do Search, com luz): ajuste fino. O Search passa a andar 1 ms por passo, sem acelerar, e o LCD dá zoom no início: cada caractere vale 10 ms e a marca do início fica no 9º caractere, então dá para ver o ataque e encostar o início nele. O LCD mostra o início em milésimos. Clicar na forma de onda põe o início exatamente ali, sem puxar para o ataque. Aperte de novo para voltar;
   - **Nudge − / +**: anda o início uma batida para trás ou para frente, seguindo as batidas achadas, e guarda o ajuste fino que já havia (segurando, repete);
   - clicar na forma de onda do LCD: o início vai para onde você clicou.
5. **Escolha o tempo alvo** no knob **Target Tempo** (60 a 180 BPM; girar rápido anda de 1 em 1, devagar de 0,1 em 0,1) e o modo, clicando nas luzes:
   - **Vari-Speed:** muda velocidade e tom juntos, como acelerar o disco (o truque dos 45 RPM).
   - **Stretch:** muda o tempo e mantém o tom.
   - **Off (Source):** o loop fica no tempo original da música.
6. **Play Loop** toca o loop marcado, repetindo, já no tempo alvo. Dá para mexer em tudo com ele tocando.
7. **Store** guarda o loop numa das 8 memórias (**Loop Memory**). Sem memória escolhida, vai para a primeira livre; com uma escolhida, substitui ela. Tire quantos loops quiser da mesma música.

## Memórias e envio

- Clicar numa memória escolhe e toca o loop dela; clicar de novo para. Escolher uma memória vazia faz o próximo Store ir para ela. O display **Loop** mostra a memória escolhida.
- **To RJ-2000:** o SP pede um pad (`Loop To Pad` / `Hit a Pad`) e depois pergunta se quer em 45 RPM, como no SAMPLE 8. A memória do SP é curta (5 s por banco), então um loop longo é cortado; o 45 RPM ajuda a caber mais.
- **To RJ-950:** o loop vira um sample do 950, já ligado a um pad livre (o LCD do 950 diz qual).
- **Disk:** o LCD pergunta o formato; Nudge troca entre WAV e MP3, Disk de novo salva. O MP3 (192 kbps) precisa de internet na primeira vez, para baixar o codificador.
- Sem memória escolhida, o Send manda o loop marcado na hora.
- **Fade:** um fade curto nas duas pontas do loop (0 a 40 ms), para não estalar quando ele repete. **Output:** volume do RJ-42.

## Bom saber

- O LCD mostra o nome da música, o início (minutos:segundos), o tamanho e a duração no tempo alvo. Na linha de baixo, a forma de onda em volta do loop: o trecho do loop fica aceso entre duas marcas, ▼ marca cada compasso (cada tempo, com 1 compasso) e um quadradinho mostra onde está tocando. **Bar . Beat** mostra em que compasso e tempo o loop começa.
- A música não fica salva no navegador (é grande demais): ao recarregar a página, solte de novo. As 8 memórias, o tempo alvo, o modo e os knobs ficam salvos.
- Todos os botões, o Search, o Target Tempo, o Fade e o Output aprendem MIDI pelo Learn do SP (SET-UP 22). No Learn, as três luzes do modo aprendem juntas: cada toque passa para o próximo modo.
- **Como o tempo é achado:** a carcaça é dos anos 80, mas a conta é recente. Força de ataque por fluxo espectral, autocorrelação generalizada e trem de pulsos (Percival e Tzanetakis, 2014) para o tempo; programação dinâmica (Ellis, 2007) para cada batida. Num teste com 51 samples de BPM conhecido, acertou 35 e deu o dobro ou a metade em outros 8 (o loop fecha igual, só com o dobro ou a metade de compassos). Funciona melhor com bateria marcada; em sample sem pulso claro (só piano, cordas), confira e use o Tap Tempo.
- **Bar . Beat** conta as batidas desde o começo da música. O RJ-42 não sabe qual batida é o 1 do compasso: se o loop começar no tempo errado, use o Nudge.
