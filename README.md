# RJ-42

Looper de rack que roda no navegador: solte uma música, ele acha o BPM e você tira loops de 1, 2, 4 ou 8 compassos no tempo que quiser. É um projeto open source da [DCX Audio](https://github.com/dcxaudio).

**Abrir:** [dcxaudio.github.io/rj-42](https://dcxaudio.github.io/rj-42/). No [DCX Studio](https://dcxaudio.github.io/dcx-studio/), ele fica embaixo do RJ-950 e manda os loops para o RJ-2000 e para o 950.

- Sozinho, os envios To RJ-2000 e To RJ-950 ficam apagados. O **Disk** salva o loop em WAV ou MP3.
- O botão **MIDI Learn** no alto da página aprende qualquer controle do painel.
- O manual está em [docs/manual.md](docs/manual.md).

## Rodar no seu computador

O código comum vem do [dcx-core](https://github.com/dcxaudio/dcx-core), um submódulo em `vendor/dcx-core`:

```bash
git clone --recurse-submodules https://github.com/dcxaudio/rj-42.git
```

```bash
cd rj-42 && python3 -m http.server 8000
```

Depois abra `http://localhost:8000`. Não tem build nem dependências.

## Estrutura

```
index.html            página solo (host do dcx-core com só o 42)
js/solo.js            monta a página: host, tela de ligar, MIDI Learn
js/r42.js             o aparelho: detecção de BPM, batidas, time stretch, memórias e envio
js/tape.js            saturação de fita (RJ.Tape, AudioWorklet), genérica para ir ao dcx-core
css/rj42.css          o painel
docs/manual.md        manual
vendor/dcx-core/      submódulo (v1.0.0)
```

## Licença

GPL-3.0 ([LICENSE](LICENSE)).
