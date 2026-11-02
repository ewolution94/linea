<script lang="ts">
  import Home from './components/Home.svelte';
  import BoardPage from './components/BoardPage.svelte';
  import Settings from './components/Settings.svelte';
  import { route, nav, timelineOf } from './lib/router.svelte.ts';
  import { ui } from './lib/prefs.svelte.ts';
  import { t } from './lib/i18n.svelte.ts';

  const timeline = $derived(timelineOf(route.path));
  const home = $derived(route.path === '/' || route.path === '');

  function keys(e: KeyboardEvent) {
    const inField = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable], ewo-sheet');
    if (e.metaKey || e.ctrlKey || e.altKey || inField || ui.settings) return;
    if (e.key === ',') {
      e.preventDefault();
      ui.settings = true;
    }
  }
</script>

<svelte:window onkeydown={keys} />

{#key route.path}
  {#if home}
    <Home />
  {:else if timeline}
    <BoardPage key={timeline.key} role={timeline.role} />
  {:else}
    <main class="missing">
      <a class="logo" href="/" onclick={nav}>L</a>
      <h1>{t('notFound.title')}</h1>
      <a class="pill solid" href="/" onclick={nav}>{t('notFound.back')}</a>
    </main>
  {/if}
{/key}
<Settings />
<ewo-toaster position="bottom"></ewo-toaster>

<style>
  .missing {
    min-height: 100dvh;
    display: grid;
    align-content: center;
    justify-items: start;
    gap: 18px;
    max-width: 560px;
    margin: 0 auto;
    padding: 0 var(--gutter);
  }

  h1 {
    font-size: 36px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .pill {
    text-decoration: none;
  }
</style>
