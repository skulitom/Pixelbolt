// Opens the first explosion when the address names no recipe. Runs before app.js, which reads the address when it starts.
if (!location.hash) history.replaceState(null, '', "#v=0.19.0&r=xZfdjuo4DMffxXtrqjRJS-ljnF1pLhAXoU0hmtCgJMyHRrz7yilw2oWZM6NF4gKpbqjz-9uJnXxA5_xORahhb9607Zzf6FlnD6YFhBftg3E91DlCr3YaauiM12tl7Uy_7a1Lowivpo1bqBclwlabzTYOz3tldYwa6g94ghr-6rpurUtAeB-sVkiaxQ1WpfgaEDxZbSlZsn6RVXVccQ0Igax5O19UKn359zBarRdNxQDhH7IX84VQspGAoC6eVc4BQQ_2Yi5k3gFCN9iqlDL53wz2uiqUZHBE0F2nmxhIwQ3h9NarnQ5QC4bQHryK6X1RIAStW6jnCOuDe1d98w41y_IK4fUUoRnLmER4cT6axsQ0LgqE1oRg9idPLMtzhMY5a_pNMkuE1qvhGUHvTIzaB6iXH5cUWRW2pD5CvZQVFnyF4FVrDgHqeVYQkg8xZTXq3V57FQ9eQ82zEqGzpnnWnvzLI16crq0KcZaP3YqsGDku6ZGSTVR9C7VAaHUfTsqqq7kqhE5Z67qOxksE_bZX9KFMIntnAnn7D1NxxcTPTKKcSpUk9cIUovLxN52c0NFqneDlWfkpn8hy_gM-ceYrGcryT3z8Jp-8wpN3opNnuqLICiz5JKcim38RwmmCi-sQfsrIMyF_wFhcVl2BUnw3w2O8PBPXeMUXfD9ZgOUFj1EI83EAr_HECa-YRE_wKzxefo7Hqm_xNc7r6Z4d74_F53A5u7VdR7x8wjam4V_T8DHNOFRFVt1KJjsTFVcBok07QqJ_fIupHDG1eu1NmLFLDaEUynGU8mnB_L1Nw17559QaGnfoh-BZ02molznDvFpR3bYu1WZ4Sl1v-LnU5VYI0StjoY7-oBFUv7Hp24ohl2xFE6QWshS0qtK-3Hj1ktQuGbKMonduBdRJOmete4WaHa8FjheBeKQ8LhkKdm95l1VVFo_On2AMRXlvgWIisHykQIZ3VydHq3P-SG0lw5zfW10xKS4PzV3O6eP_KXCFYJ17TkfOzmjbJqlDHR5jhXRCp1M54Wy9DltnWxpi1MCoibBM0tStidtUmyl4Z5fjaj92--uicOqSJ3d87G4o9X9y6E6he7rhdI45NZY8W0wwKYBb0-vhCuB2NNccoTtYmzoTgteq2ULN6TynqAulP4Sde6Y8gEq3EbqB0K3jhhjSgtT1WVZdaYLGatUf9jR9iF69hyHRx-Px-C8");
addEventListener('DOMContentLoaded', () => {
  const links = [...document.querySelectorAll('.presets a')], recipe = document.getElementById('recipe');
  // The text the visitor typed. While the editor still holds it, no preset is the recipe on screen.
  let typed = null;
  const clear = () => { for (const link of links) link.removeAttribute('aria-current'); };
  const mark = () => {
    clear();
    // A recipe the engine refused is in the editor: the preset is no longer what it holds.
    if (document.body.dataset.state === 'error') return;
    if (typed !== null && recipe.value === typed) return;
    typed = null;
    links.find(link => link.getAttribute('href') === location.hash)?.setAttribute('aria-current', 'true');
  };
  mark();
  addEventListener('hashchange', mark);
  // Every finished render, whatever opened it (a preset, an example, a file), re-reads what is on screen.
  new MutationObserver(mark).observe(document.getElementById('digest'), { childList: true, characterData: true, subtree: true });
  new MutationObserver(mark).observe(document.body, { attributes: true, attributeFilter: ['data-state'] });
  recipe.addEventListener('input', () => { typed = recipe.value; clear(); });
  document.getElementById('examples').addEventListener('change', clear);
  // A link to the address already open fires no hashchange, so without this the current preset could not undo an edit.
  document.addEventListener('click', event => {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('.presets a');
    if (link && link.getAttribute('href') === location.hash) { event.preventDefault(); dispatchEvent(new HashChangeEvent('hashchange')); }
  });
});
