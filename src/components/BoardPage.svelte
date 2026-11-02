<!--
  A timeline's page, by its edit link or its view link: the header (name, who's here, undo, the scale,
  Today, Share, Settings), the timeline, and the sheets. On the phone the header takes two rows and a
  + adds an item where you're looking.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import Timeline from './Timeline.svelte';
  import ItemSheet from './ItemSheet.svelte';
  import LaneSheet from './LaneSheet.svelte';
  import Share from './Share.svelte';
  import People from './People.svelte';
  import { Board, type Role } from '../lib/board.svelte.ts';
  import { View } from '../lib/view.svelte.ts';
  import { SCALES, ZOOM } from '../lib/layout.ts';
  import { ui } from '../lib/prefs.svelte.ts';
  import { nav } from '../lib/router.svelte.ts';
  import { LIMITS } from '../../shared/model.mjs';
  import { t } from '../lib/i18n.svelte.ts';
  import { toast } from '../../vendor/ewo/elements/toaster.js';

  let { key, role }: { key: string; role: Role } = $props();

  // svelte-ignore state_referenced_locally
  const board = new Board(key, role);
  const view = new View();
  void board.open();
  onDestroy(() => board.close());

  const media = matchMedia('(max-width: 699px)');
  let phone = $state(media.matches);
  $effect(() => {
    const on = () => (phone = media.matches);
    media.addEventListener('change', on);
    return () => media.removeEventListener('change', on);
  });

  let timeline = $state<ReturnType<typeof Timeline>>();
  const ro = $derived(board.readOnly);
  const name = $derived(board.doc.name);

  $effect(() => {
    if (board.status === 'ready') document.title = `${name || t('board.untitled')} · Linea`;
  });

  $effect(() => {
    if (board.problem === 'full') toast(t('state.full', { items: LIMITS.items.toLocaleString(), lanes: LIMITS.lanes }), { tone: 'bad', duration: 6000 });
    else if (board.problem === 'rejected') toast(t('state.rejected'), { tone: 'bad' });
  });

  function rename(value: string) {
    const next = value.replace(/\s+/g, ' ').trim();
    if (next !== board.doc.name) board.change([{ op: 'name', name: next }]);
  }

  const scaleLabel = (s: string) => t(`scale.${s}` as 'scale.week');
  const zoom = $derived(ZOOM[phone ? 'phone' : 'desk']);
</script>

{#snippet scales()}
  <div class="seg scales" role="group" aria-label={t('board.scale')}>
    {#each SCALES as s (s)}
      <button type="button" aria-pressed={view.scale === s} onclick={() => view.zoomTo(zoom[s])}>{scaleLabel(s)}</button>
    {/each}
  </div>
{/snippet}

{#snippet title()}
  {#if ro}
    <h1 class="ttl ro">{name || t('board.untitled')}</h1>
  {:else}
    <input
      class="ttl"
      value={name}
      placeholder={t('board.untitled')}
      aria-label={t('board.name')}
      maxlength="120"
      spellcheck="false"
      onchange={(e) => rename(e.currentTarget.value)}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
      }}
    />
  {/if}
{/snippet}

{#snippet settingsButton()}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <ewo-settings-button label={t('settings.title')} onclick={() => (ui.settings = true)}></ewo-settings-button>
{/snippet}

<div class="page" class:phone>
  {#if board.status === 'ready'}
    <header class="hd">
      {#if phone}
        <div class="ph1">
          <a class="logo small" href="/" onclick={nav} aria-label={t('board.home')}>L</a>
          {@render title()}
          <People {board} />
          <button type="button" class="pill solid round" aria-label={t('board.share')} onclick={() => (view.sheet = 'share')}><Icon name="link" size={17} /></button>
          {@render settingsButton()}
        </div>
        <div class="ph2">
          {@render scales()}
          <button type="button" class="pill round" aria-label={t('board.todayLong')} onclick={() => view.toToday()}><Icon name="today" size={17} /></button>
        </div>
      {:else}
        <div class="hrow">
          <a class="brand" href="/" onclick={nav} aria-label={t('board.home')}><span class="logo">L</span><b class="wm">Linea</b></a>
          <span class="vr"></span>
          {@render title()}
          {#if board.role === 'view'}
            <span class="tag"><Icon name="eye" size={14} />{t('board.viewOnly')}</span>
          {:else}
            <span class="live" class:off={board.conn !== 'online'}><i></i>{board.conn === 'online' ? t('board.live') : t('board.offline')}</span>
          {/if}
          <span class="sp"></span>
          <People {board} />
          {#if !ro}
            <span class="ur">
              <button type="button" class="icon-btn" aria-label={t('board.undo')} title={t('board.undo')} disabled={!board.canUndo} onclick={() => board.undo()}><Icon name="undo" /></button>
              <button type="button" class="icon-btn" aria-label={t('board.redo')} title={t('board.redo')} disabled={!board.canRedo} onclick={() => board.redo()}><Icon name="redo" /></button>
            </span>
          {/if}
          {@render scales()}
          <button type="button" class="pill" title={t('board.todayLong')} onclick={() => view.toToday()}><Icon name="today" /><span>{t('board.today')}</span></button>
          <button type="button" class="pill solid" onclick={() => (view.sheet = 'share')}><Icon name="link" /><span>{t('board.share')}</span></button>
          {@render settingsButton()}
        </div>
      {/if}
      {#if board.offline}
        <p class="banner">{t('state.offlineRead')}</p>
      {/if}
    </header>

    <Timeline bind:this={timeline} {board} {view} {phone} />

    {#if phone && !ro && view.sheet === null}
      <button type="button" class="fab" aria-label={t('board.add')} onclick={() => view.add()}><Icon name="plus" size={24} /></button>
    {/if}

    <ItemSheet {board} {view} onremove={(id) => timeline?.removeItem(id)} />
    <LaneSheet {board} {view} />
    <Share {board} {view} />
    <ewo-connection state={board.conn}></ewo-connection>
  {:else}
    <header class="hd">
      <div class="hrow">
        <a class="brand" href="/" onclick={nav} aria-label={t('board.home')}><span class="logo">L</span><b class="wm">Linea</b></a>
        <span class="sp"></span>
        {@render settingsButton()}
      </div>
    </header>
    <main class="state">
      {#if board.status === 'loading'}
        <p class="wait" aria-live="polite">{t('state.loading')}</p>
      {:else}
        <h1>{board.status === 'gone' ? t('state.gone') : board.status === 'unreachable' ? t('home.offline') : t('state.missing')}</h1>
        {#if board.status !== 'unreachable'}
          <p>{board.status === 'gone' ? t('state.goneNote') : t('state.missingNote')}</p>
        {/if}
        <a class="pill solid" href="/" onclick={nav}>{t('state.home')}</a>
      {/if}
    </main>
  {/if}
</div>

<style>
  .page {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .hd {
    flex: none;
    position: relative;
    z-index: 8;
    background: var(--axbg);
    border-bottom: 1px solid var(--rule);
    padding-top: env(safe-area-inset-top, 0px);
  }

  .hrow {
    height: 58px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left));
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    flex: none;
  }

  .wm {
    font-weight: 800;
    font-size: 19px;
    letter-spacing: -0.01em;
  }

  .vr {
    width: 1px;
    height: 22px;
    background: var(--rule);
    flex: none;
  }

  .sp {
    flex: 1 1 auto;
  }

  .ttl {
    flex: 0 1 260px;
    min-width: 80px;
    box-sizing: border-box;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    outline: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ttl:focus {
    background: var(--pop);
    box-shadow: 0 0 0 1.5px var(--focus);
  }

  h1.ttl {
    flex: 0 1 auto;
  }

  .live,
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ink2);
    white-space: nowrap;
    flex: none;
  }

  .live i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent);
  }

  .live.off i {
    background: var(--ink2);
    box-shadow: none;
  }

  .tag {
    padding: 4px 10px 4px 8px;
    border-radius: 999px;
    background: var(--ground);
    font-weight: 600;
  }

  .ur {
    display: inline-flex;
    gap: 2px;
    flex: none;
  }

  .banner {
    padding: 8px 16px;
    font-size: 13px;
    background: var(--ground);
    color: var(--ink2);
    border-top: 1px solid var(--rule);
  }

  @media (max-width: 1180px) {
    .wm,
    .live {
      display: none;
    }
  }

  @media (max-width: 920px) {
    .vr {
      display: none;
    }

    .hrow .pill:not(.solid) span {
      display: none;
    }

    .hrow .pill:not(.solid) {
      width: 34px;
      padding: 0;
    }
  }

  /* The phone: two rows. */
  .ph1 {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 0 12px;
  }

  .ph1 .ttl {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 16px;
  }

  .logo.small {
    width: 28px;
    height: 28px;
    font-size: 17px;
  }

  .ph2 {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px 10px;
  }

  .ph2 .scales {
    flex: 1 1 auto;
    display: flex;
  }

  .ph2 .scales button {
    flex: 1 1 0;
    padding-inline: 6px;
  }

  .fab {
    position: fixed;
    right: max(18px, env(safe-area-inset-right));
    bottom: calc(24px + env(safe-area-inset-bottom, 0px));
    z-index: 20;
    width: 56px;
    height: 56px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--ink);
    color: var(--pop);
    box-shadow: 0 8px 20px rgb(0 0 0 / 0.28);
  }

  .state {
    flex: 1 1 auto;
    display: grid;
    align-content: center;
    justify-items: start;
    gap: 14px;
    max-width: 560px;
    margin: 0 auto;
    padding: 32px var(--gutter);
  }

  .state h1 {
    font-size: clamp(26px, 5vw, 36px);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }

  .state p {
    color: var(--ink2);
  }

  .state .pill {
    text-decoration: none;
    margin-top: 8px;
  }

  .wait {
    color: var(--ink2);
  }

  ewo-connection {
    --ewo-connection-top: calc(env(safe-area-inset-top, 0px) + 70px);
  }
</style>
