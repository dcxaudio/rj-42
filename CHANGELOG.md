# Changelog

## Próxima

- Saturação de fita (`RJ.Tape`, que mora no dcx-core v1.1.0: `vendor/dcx-core/js/tape.js`) entre o Output e a saída: tanh com ADAA de 1ª ordem, pré e de-ênfase, perda de agudos e wow/flutter leve, num AudioWorklet. O Drive fica no menu TAPE do LCD (clique na linha de cima e gire o Search), salva com o resto e aprende MIDI. O padrão é OFF, e com ele o som sai igual, bit a bit.
- As regras `.r9-*` do `css/rj42.css` ficam escopadas em `:where(.r42)` (mesma especificidade, o 42 não muda): no DCX Studio elas não vazam mais para o painel do RJ-950 (`#r9`).

## b0.1 (beta)

- O RJ-42 ganha repositório e página próprios. O histórico de `js/r42.js` vem do [RJ-2000](https://github.com/dcxaudio/rj-2000), onde ele nasceu como o looper embaixo do RJ-950.
- Página solo com o host do [dcx-core](https://github.com/dcxaudio/dcx-core) v1.0.0 (submódulo em `vendor/dcx-core`). Os dados ficam no navegador com o prefixo `rj42/`.
- Sozinho, To RJ-2000 e To RJ-950 ficam apagados. O Disk (WAV ou MP3) continua.
- Botão **MIDI Learn** na página, para aprender sem o SET-UP 22 do RJ-2000.
