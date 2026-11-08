/* RJ-42 - pagina solo
 *
 * Monta um host so com o 42 (RJ.Host.solo): targets() devolve so "file", entao
 * To RJ-2000 e To RJ-950 ficam apagados e o Disk continua. O armazenamento usa o
 * prefixo "rj42/". No Studio, quem monta o 42 e a pagina do dcx-studio.
 */
(function () {
  "use strict";
  const RJ = window.RJ;

  window.addEventListener("DOMContentLoaded", () => {
    const host = RJ.Host.solo("rj42");
    const r42 = new RJ.R42(host.view("rj42"));
    host.add("rj42", r42, { label: "RJ-42" });
    r42.build();
    new RJ.LearnBar(host, { root: document.getElementById("r42"), bar: document.getElementById("learnbar") });

    // tela de ligar: o navegador so libera o som depois de um toque
    const power = document.getElementById("power");
    const on = () => { host.power(); power.classList.add("off"); };
    document.getElementById("power-btn").addEventListener("click", on);
    window.addEventListener("keydown", e => {
      if (host.on || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); on(); }
    });

    // no console: RJ.solo (o host) e RJ.r42
    RJ.solo = host; RJ.r42 = r42;
  });
})();
