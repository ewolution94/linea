<!--
  The home: what Linea is, New timeline (or the example, or a file), and the timelines this device has
  opened, newest first. There are no accounts, so the list lives on the device and "Remove from this
  list" forgets only the entry.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { go, nav } from '../lib/router.svelte.ts';
  import { recent, remember, forget } from '../lib/recent.svelte.ts';
  import { ui } from '../lib/prefs.svelte.ts';
  import { example, fromFile } from '../lib/files.ts';
  import { locale, t } from '../lib/i18n.svelte.ts';
  import { toast } from '../../vendor/ewo/elements/toaster.js';
  import type { Doc } from '../../shared/model.mjs';

  let busy = $state(false);
  let picker: HTMLInputElement;

  $effect(() => {
    document.title = 'Linea';
  });

  async function make(doc?: Doc) {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch('/api/new', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(doc ? { doc } : { lang: locale() }),
      });
      if (res.status === 429) throw new Error('many');
      if (!res.ok) throw new Error(String(res.status));
      const { edit, view } = (await res.json()) as { edit: string; view: string };
      remember({ view, edit, name: doc?.name ?? '' });
      go(`/e/${edit}`);
    } catch (error) {
      const message = !navigator.onLine ? t('home.offline') : (error as Error).message === 'many' ? t('home.tooMany') : t('home.failed');
      toast(message, { tone: 'bad' });
    } finally {
      busy = false;
    }
  }

  async function openFile(file: File | undefined) {
    if (!file) return;
    const doc = fromFile(await file.text());
    if (!doc) {
      toast(t('home.notFile'), { tone: 'bad' });
      return;
    }
    await make(doc);
  }

  function remove(view: string) {
    forget(view);
    toast(t('home.removed'));
  }

  const when = (at: number) => {
    const days = Math.round((Date.now() - at) / 86_400_000);
    const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
    if (days < 1) return rtf.format(0, 'day');
    if (days < 7) return rtf.format(-days, 'day');
    return new Intl.DateTimeFormat(locale() === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(at);
  };

  // The page's drawing: three lines with their stops, the way a plan reads in Linea.
  const LINES = [
    { c: 0, y: 34, s: 18, e: 250, stops: [60, 150] },
    { c: 3, y: 74, s: 90, e: 330, stops: [130, 260] },
    { c: 1, y: 114, s: 40, e: 210, stops: [] },
  ];
</script>

<div class="home">
  <header class="top">
    <a class="brand" href="/" onclick={nav}><span class="logo">L</span><b>Linea</b></a>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <ewo-settings-button label={t('settings.title')} onclick={() => (ui.settings = true)}></ewo-settings-button>
  </header>

  <main>
    <section class="hero">
      <div class="words">
        <h1>{t('app.tagline')}</h1>
        <p class="lead">{t('home.lead')}</p>
        <div class="actions">
          <button type="button" class="pill solid big" disabled={busy} onclick={() => make()}><Icon name="plus" />{busy ? t('home.making') : t('home.new')}</button>
          <button type="button" class="pill big" disabled={busy} onclick={() => make(example())}>{t('home.example')}</button>
          <button type="button" class="pill big" disabled={busy} onclick={() => picker.click()}><Icon name="open" />{t('home.import')}</button>
          <input bind:this={picker} class="sr" type="file" accept=".json,application/json" tabindex="-1" aria-hidden="true" onchange={(e) => (openFile(e.currentTarget.files?.[0]), (e.currentTarget.value = ''))} />
        </div>
        <p class="nolink">{t('home.nolink')}</p>
      </div>
      <svg class="map" viewBox="0 0 360 148" aria-hidden="true">
        {#each LINES as l (l.y)}
          <rect class="rail c{l.c}" x="0" y={l.y - 2} width="360" height="4" rx="2" />
          <rect class="sec c{l.c}" x={l.s} y={l.y - 12} width={l.e - l.s} height="24" rx="12" />
          <circle class="stop c{l.c}" cx={l.s + 16} cy={l.y} r="3" />
          <circle class="stop c{l.c}" cx={l.e - 16} cy={l.y} r="3" />
        {/each}
        <circle class="station" cx="300" cy="114" r="8" />
        <rect class="today" x="221" y="0" width="2" height="148" />
      </svg>
    </section>

    <section class="list" aria-labelledby="recent-h">
      <h2 id="recent-h" class="label">{t('home.recent')}</h2>
      {#if recent.list.length}
        <ul>
          {#each recent.list as r (r.view)}
            <li>
              <a href={r.edit ? `/e/${r.edit}` : `/v/${r.view}`} onclick={nav}>
                <b>{r.name || t('board.untitled')}</b>
                <span class="meta"><span class="role" class:edit={!!r.edit}><Icon name={r.edit ? 'pencil' : 'eye'} size={13} />{r.edit ? t('home.edit') : t('home.view')}</span><span>{when(r.at)}</span></span>
              </a>
              <button type="button" class="icon-btn" aria-label="{t('home.remove')}: {r.name || t('board.untitled')}" title={t('home.remove')} onclick={() => remove(r.view)}><Icon name="x" size={16} /></button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">{t('home.empty')}</p>
      {/if}
    </section>

    <section class="how">
      <ol>
        <li><span class="dot c0"></span>{t('home.how1')}</li>
        <li><span class="dot c3"></span>{t('home.how2')}</li>
        <li><span class="dot c1"></span>{t('home.how3')}</li>
      </ol>
    </section>
  </main>
</div>

<style>
  .home {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .top {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 58px;
    padding: env(safe-area-inset-top, 0px) var(--gutter) 0;
    background: var(--axbg);
    border-bottom: 1px solid var(--rule);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
  }

  .brand b {
    font-weight: 800;
    font-size: 19px;
    letter-spacing: -0.01em;
  }

  main {
    width: 100%;
    max-width: 1080px;
    box-sizing: border-box;
    margin: 0 auto;
    padding: 0 var(--gutter) 64px;
    display: grid;
    gap: 40px;
  }

  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr);
    gap: 40px;
    align-items: center;
    padding-top: 56px;
  }

  h1 {
    font-size: clamp(34px, 5.4vw, 58px);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.02;
  }

  .lead {
    margin-top: 16px;
    max-width: 52ch;
    font-size: 17px;
    color: var(--ink2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 28px;
  }

  .pill.big {
    height: 44px;
    padding: 0 18px;
    font-size: 14.5px;
  }

  .nolink {
    margin-top: 14px;
    font-size: 13px;
    color: var(--ink2);
  }

  .map {
    width: 100%;
    height: auto;
    overflow: visible;
  }

  .map .rail {
    fill: var(--c);
    opacity: var(--rail);
  }

  .map .sec {
    fill: var(--c);
  }

  .map .stop {
    fill: var(--k);
  }

  .map .station {
    fill: var(--st);
    stroke: var(--ink);
    stroke-width: 4;
  }

  .map .today {
    fill: var(--today);
  }

  .list {
    display: grid;
    gap: 10px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    border-radius: 16px;
    background: var(--axbg);
    box-shadow: 0 0 0 1px var(--rule);
    overflow: hidden;
  }

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 10px;
    border-bottom: 1px solid var(--rule);
  }

  li:last-child {
    border-bottom: 0;
  }

  li a {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    gap: 4px;
    padding: 14px 16px;
    text-decoration: none;
  }

  li b {
    font-size: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    gap: 12px;
    color: var(--ink2);
    font-size: 13px;
  }

  .role {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
  }

  .role.edit {
    color: var(--ink);
  }

  .empty {
    padding: 20px;
    border-radius: 16px;
    border: 1.5px dashed var(--rule);
    color: var(--ink2);
  }

  .how ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    position: relative;
  }

  .how li {
    display: grid;
    gap: 10px;
    align-content: start;
    padding: 0;
    border: 0;
    color: var(--ink2);
    font-size: 14px;
  }

  .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--st);
    border: 4px solid var(--c);
  }

  @media (hover: hover) and (pointer: fine) {
    li a:hover b {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  }

  @media (max-width: 760px) {
    .hero {
      grid-template-columns: 1fr;
      gap: 28px;
      padding-top: 32px;
    }

    .map {
      order: -1;
      max-width: 320px;
    }

    .how ol {
      grid-template-columns: 1fr;
    }

    .how li {
      grid-template-columns: auto 1fr;
      align-items: center;
    }
  }
</style>
